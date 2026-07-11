import { createServerFn } from '@tanstack/react-start'
import { app, buildAssetStore, resetApp } from './app'
import { workflow } from '../core/workflow'
import { validSourceUrl } from '../core/services'
import type { StorageConfig } from '../core/types'
import { hashPassword } from '../adapters/auth'
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

export const sessionInfo = createServerFn({ method: 'GET' }).handler(async () => rpc(async () => {
  const instance = await app()
  const identity = instance.auth.current()
  return {
    identity,
    setupRequired: process.env.AUTH_PROVIDER !== 'trusted-header' && instance.repository.countUsers() === 0,
    authProvider: process.env.AUTH_PROVIDER ?? 'local',
    workflow,
  }
}))

export const setupOperator = createServerFn({ method: 'POST' })
  .validator((data: { email: string; name: string; password: string }) => data)
  .handler(async ({ data }) => rpc(async () => { requireMutationOrigin(); return (await app()).auth.setup(data) }))

export const login = createServerFn({ method: 'POST' })
  .validator((data: { email: string; password: string }) => data)
  .handler(async ({ data }) => rpc(async () => { requireMutationOrigin(); return (await app()).auth.login(data) }))

export const logout = createServerFn({ method: 'POST' }).handler(async () => rpc(async () => { requireMutationOrigin(); return (await app()).auth.logout() }))

export const changePassword = createServerFn({ method: 'POST' })
  .validator((data: { currentPassword: string; newPassword: string }) => data)
  .handler(async ({ data }) => rpc(async () => { requireMutationOrigin(); return (await app()).auth.changePassword(data) }))

export const createUser = createServerFn({ method: 'POST' })
  .validator((data: { email: string; name: string; password: string; role: 'requester' | 'operator' }) => data)
  .handler(async ({ data }) => rpc(async () => {
    requireMutationOrigin()
    const instance = await app()
    if (instance.auth.require().role !== 'operator') throw new Response('forbidden', { status: 403 })
    if (data.role !== 'requester' && data.role !== 'operator') throw new Response('invalid role', { status: 400 })
    if (typeof data.email !== 'string' || typeof data.name !== 'string' || typeof data.password !== 'string' ||
      data.email.length > 254 || data.name.length > 100 || data.password.length < 8 || data.password.length > 256 ||
      !/^\S+@\S+\.\S+$/.test(data.email) || !data.name.trim()) throw new Response('invalid user', { status: 400 })
    const user = instance.repository.createUser({ ...data, passwordHash: await hashPassword(data.password) })
    instance.events.publish('user.created')
    return user
  }))

export const listRequests = createServerFn({ method: 'GET' }).handler(async () => rpc(async () => {
  const instance = await app()
  return instance.service.listRequests(instance.auth.require())
}))

export const listPeople = createServerFn({ method: 'GET' }).handler(async () => rpc(async () => {
  const instance = await app()
  instance.auth.require()
  return instance.service.listPeople()
}))

export const listUsers = createServerFn({ method: 'GET' }).handler(async () => rpc(async () => {
  const instance = await app()
  if (instance.auth.require().role !== 'operator') throw new Response('forbidden', { status: 403 })
  return instance.repository.listUsers()
}))

function maskStorage(config: StorageConfig) {
  return config.adapter === 's3' ? { ...config, secretAccessKey: '' } : config
}

export const getStorageSettings = createServerFn({ method: 'GET' }).handler(async () => rpc(async () => {
  const instance = await app()
  if (instance.auth.require().role !== 'operator') throw new Response('forbidden', { status: 403 })
  return maskStorage(instance.storage)
}))

export const updateStorageSettings = createServerFn({ method: 'POST' })
  .validator((data: StorageConfig) => data)
  .handler(async ({ data }) => rpc(async () => {
    requireMutationOrigin()
    const instance = await app()
    if (instance.auth.require().role !== 'operator') throw new Response('forbidden', { status: 403 })

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
  .handler(async ({ data }) => rpc(async () => { requireMutationOrigin(); const instance = await app(); return instance.service.moveCopies(data, instance.auth.require()) }))

export const reorderRequest = createServerFn({ method: 'POST' })
  .validator((data: { id: string; status: string; order: number }) => data)
  .handler(async ({ data }) => rpc(async () => { requireMutationOrigin(); const instance = await app(); return instance.service.reorder(data.id, data.status, data.order, instance.auth.require()) }))

export const updateRequest = createServerFn({ method: 'POST' })
  .validator((data: { id: string; name?: string; quantity?: number; requesterName?: string; notes?: string; sourceUrl?: string }) => data)
  .handler(async ({ data }) => rpc(async () => {
    requireMutationOrigin()
    const { id, ...fields } = data
    const instance = await app()
    instance.service.update(id, fields, instance.auth.require())
  }))

export const deleteRequest = createServerFn({ method: 'POST' })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => rpc(async () => { requireMutationOrigin(); const instance = await app(); return instance.service.remove(data.id, instance.auth.require()) }))
