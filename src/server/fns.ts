import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { app, buildAssetStore, resetApp, resolveBoardConfig, resolveTelemetryConfig } from './app'
import { workflow } from '../core/workflow'
import { validSourceUrl } from '../core/services'
import type { StorageConfig } from '../core/types'
import { requireMutationOrigin } from './mutationOrigin'

// The app throws Response for HTTP handlers, but a Response thrown inside a
// server fn is delivered as a plain response and the client promise resolves
// as if the call succeeded. Convert to real errors so callers can catch.
async function rpc<T>(work: () => Promise<T> | T): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof Response) throw new Error((await error.text()) || `request failed (${error.status})`)
    throw error
  }
}

const me = async (instance: Awaited<ReturnType<typeof app>>) => instance.requireIdentity(getRequest().headers)

export const sessionInfo = createServerFn({ method: 'GET' }).handler(async () => rpc(async () => {
  const instance = await app()
  const identity = await instance.identity(getRequest().headers)
  return {
    identity,
    setupRequired: instance.repository.countUsers() === 0,
    telemetryEnabled: resolveTelemetryConfig(instance.repository).enabled,
    privateRequests: resolveBoardConfig(instance.repository).privateRequests,
    workflow,
  }
}))

export const listRequests = createServerFn({ method: 'GET' }).handler(async () => rpc(async () => {
  const instance = await app()
  return instance.service.listRequests(await me(instance), resolveBoardConfig(instance.repository).privateRequests)
}))

export const listPeople = createServerFn({ method: 'GET' }).handler(async () => rpc(async () => {
  const instance = await app()
  const identity = await me(instance)
  // With private requests, requesters see no one else — not even names.
  if (identity.role !== 'operator' && resolveBoardConfig(instance.repository).privateRequests) {
    return instance.service.listPeople().filter((person) => person.name === identity.name)
  }
  return instance.service.listPeople()
}))

export const listUsers = createServerFn({ method: 'GET' }).handler(async () => rpc(async () => {
  const instance = await app()
  if ((await me(instance)).role !== 'operator') throw new Response('forbidden', { status: 403 })
  return instance.repository.listUsers()
}))

function maskStorage(config: StorageConfig) {
  return config.adapter === 's3' ? { ...config, secretAccessKey: '' } : config
}

export const getTelemetrySettings = createServerFn({ method: 'GET' }).handler(async () => rpc(async () => {
  const instance = await app()
  if ((await me(instance)).role !== 'operator') throw new Response('forbidden', { status: 403 })
  return resolveTelemetryConfig(instance.repository)
}))

export const updateTelemetrySettings = createServerFn({ method: 'POST' })
  .validator((data: { enabled: boolean }) => data)
  .handler(async ({ data }) => rpc(async () => {
    const instance = await app()
    requireMutationOrigin()
    if ((await me(instance)).role !== 'operator') throw new Response('forbidden', { status: 403 })
    const config = { enabled: data.enabled === true }
    instance.repository.setSetting('telemetry', config)
    return config
  }))

export const getBoardSettings = createServerFn({ method: 'GET' }).handler(async () => rpc(async () => {
  const instance = await app()
  if ((await me(instance)).role !== 'operator') throw new Response('forbidden', { status: 403 })
  return resolveBoardConfig(instance.repository)
}))

export const updateBoardSettings = createServerFn({ method: 'POST' })
  .validator((data: { privateRequests: boolean }) => data)
  .handler(async ({ data }) => rpc(async () => {
    const instance = await app()
    requireMutationOrigin()
    if ((await me(instance)).role !== 'operator') throw new Response('forbidden', { status: 403 })
    const config = { privateRequests: data.privateRequests === true }
    instance.repository.setSetting('board', config)
    // Boards refetch over SSE so requesters' views update immediately.
    instance.events.publish('board.changed')
    return config
  }))

export const getStorageSettings = createServerFn({ method: 'GET' }).handler(async () => rpc(async () => {
  const instance = await app()
  if ((await me(instance)).role !== 'operator') throw new Response('forbidden', { status: 403 })
  return maskStorage(instance.storage)
}))

export const updateStorageSettings = createServerFn({ method: 'POST' })
  .validator((data: StorageConfig) => data)
  .handler(async ({ data }) => rpc(async () => {
    const instance = await app()
    requireMutationOrigin()
    if ((await me(instance)).role !== 'operator') throw new Response('forbidden', { status: 403 })

    let config: StorageConfig
    if (data.adapter === 'local') {
      const root = typeof data.root === 'string' ? data.root.trim() : ''
      if (!root || root.length > 500 || !root.startsWith('/')) throw new Response('folder must be an absolute path', { status: 400 })
      config = { adapter: 'local', root }
    } else if (data.adapter === 's3') {
      const current = instance.storage
      // A blank secret keeps the currently saved one so edits never echo it.
      const secretAccessKey = data.secretAccessKey || (current.adapter === 's3' ? current.secretAccessKey : '')
      if (typeof data.endpoint !== 'string' || !validSourceUrl(data.endpoint.trim())) throw new Response('endpoint must be an http(s) URL', { status: 400 })
      if (typeof data.bucket !== 'string' || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(data.bucket)) throw new Response('invalid bucket name', { status: 400 })
      if (typeof data.region !== 'string' || data.region.length > 64) throw new Response('invalid region', { status: 400 })
      const prefix = typeof data.prefix === 'string' ? data.prefix.trim().replace(/^\/+|\/+$/g, '') : ''
      if (prefix.length > 200 || prefix.split('/').some((segment) => segment === '.' || segment === '..')) throw new Response('invalid prefix', { status: 400 })
      if (typeof data.accessKeyId !== 'string' || !data.accessKeyId.trim() || data.accessKeyId.length > 128) throw new Response('missing access key', { status: 400 })
      if (typeof secretAccessKey !== 'string' || !secretAccessKey || secretAccessKey.length > 256) throw new Response('missing secret access key', { status: 400 })
      config = {
        adapter: 's3',
        endpoint: data.endpoint.trim(),
        region: data.region.trim(),
        bucket: data.bucket,
        prefix: prefix || undefined,
        accessKeyId: data.accessKeyId.trim(),
        secretAccessKey,
        forcePathStyle: data.forcePathStyle === true,
      }
    } else {
      throw new Response('unknown storage adapter', { status: 400 })
    }

    if (instance.repository.listRequests().length > 0 || instance.repository.listOperations().length > 0 || instance.repository.activeUploadIds(Date.now()).size > 0) {
      throw new Response('storage can only be changed while the board is empty and no uploads are in flight', { status: 409 })
    }

    const candidate = buildAssetStore(config)
    try {
      await candidate.initialize()
      await candidate.writable()
    } catch (error) {
      throw new Response(`storage is not reachable or not writable: ${error instanceof Error ? error.message : 'unknown error'}`, { status: 400 })
    }

    instance.repository.setSetting('storage', config)
    await resetApp()
    return maskStorage(config)
  }))

export const moveCopies = createServerFn({ method: 'POST' })
  .validator((data: { id: string; from: string; to: string; count: number; order?: number }) => data)
  .handler(async ({ data }) => rpc(async () => { const instance = await app(); requireMutationOrigin(); return instance.service.moveCopies(data, await me(instance)) }))

export const reorderRequest = createServerFn({ method: 'POST' })
  .validator((data: { id: string; status: string; order: number }) => data)
  .handler(async ({ data }) => rpc(async () => { const instance = await app(); requireMutationOrigin(); return instance.service.reorder(data.id, data.status, data.order, await me(instance)) }))

export const updateRequest = createServerFn({ method: 'POST' })
  .validator((data: { id: string; name?: string; quantity?: number; requesterName?: string; notes?: string; sourceUrl?: string }) => data)
  .handler(async ({ data }) => rpc(async () => {
    const instance = await app()
    requireMutationOrigin()
    const { id, ...fields } = data
    instance.service.update(id, fields, await me(instance))
  }))

export const deleteRequest = createServerFn({ method: 'POST' })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => rpc(async () => { const instance = await app(); requireMutationOrigin(); return instance.service.remove(data.id, await me(instance)) }))
