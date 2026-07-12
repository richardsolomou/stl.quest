import { createServerFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'
import { app, buildAssetStore, resetApp, resolveBoardConfig } from './app'
import { workflow } from '../core/workflow'
import { validSourceUrl } from '../core/services'
import type { AuthConfig, StorageConfig, TelemetryConfig } from '../core/types'
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
    setupRequired: instance.authConfig.provider === 'local' && instance.repository.countUsers() === 0,
    authProvider: instance.authConfig.provider,
    // The project token is public by design (it ships in any browser bundle).
    telemetry: instance.telemetryConfig?.token ? { token: instance.telemetryConfig.token, host: instance.telemetryConfig.host } : null,
    privateRequests: resolveBoardConfig(instance.repository).privateRequests,
    workflow,
  }
}))

export const setupOperator = createServerFn({ method: 'POST' })
  .validator((data: { email: string; name: string; password: string }) => data)
  .handler(async ({ data }) => rpc(async () => { const instance = await app(); requireMutationOrigin(instance.authConfig.provider); return instance.auth.setup(data) }))

export const login = createServerFn({ method: 'POST' })
  .validator((data: { email: string; password: string }) => data)
  .handler(async ({ data }) => rpc(async () => { const instance = await app(); requireMutationOrigin(instance.authConfig.provider); return instance.auth.login(data) }))

export const logout = createServerFn({ method: 'POST' }).handler(async () => rpc(async () => { const instance = await app(); requireMutationOrigin(instance.authConfig.provider); return instance.auth.logout() }))

export const changePassword = createServerFn({ method: 'POST' })
  .validator((data: { currentPassword: string; newPassword: string }) => data)
  .handler(async ({ data }) => rpc(async () => { const instance = await app(); requireMutationOrigin(instance.authConfig.provider); return instance.auth.changePassword(data) }))

export const createUser = createServerFn({ method: 'POST' })
  .validator((data: { email: string; name: string; password: string; role: 'requester' | 'operator' }) => data)
  .handler(async ({ data }) => rpc(async () => {
    const instance = await app()
    requireMutationOrigin(instance.authConfig.provider)
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
  return instance.service.listRequests(instance.auth.require(), resolveBoardConfig(instance.repository).privateRequests)
}))

export const listPeople = createServerFn({ method: 'GET' }).handler(async () => rpc(async () => {
  const instance = await app()
  const identity = instance.auth.require()
  // With private requests, requesters see no one else — not even names.
  if (identity.role !== 'operator' && resolveBoardConfig(instance.repository).privateRequests) {
    return instance.service.listPeople().filter((person) => person.name === identity.name)
  }
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

function maskAuth(config: AuthConfig) {
  return config.provider === 'trusted-header' ? { ...config, proxySecret: '' } : config
}

export const getTelemetrySettings = createServerFn({ method: 'GET' }).handler(async () => rpc(async () => {
  const instance = await app()
  if (instance.auth.require().role !== 'operator') throw new Response('forbidden', { status: 403 })
  return instance.telemetryConfig ?? { token: '', host: '' }
}))

export const updateTelemetrySettings = createServerFn({ method: 'POST' })
  .validator((data: { token: string; host: string }) => data)
  .handler(async ({ data }) => rpc(async () => {
    const instance = await app()
    requireMutationOrigin(instance.authConfig.provider)
    if (instance.auth.require().role !== 'operator') throw new Response('forbidden', { status: 403 })
    const token = typeof data.token === 'string' ? data.token.trim() : ''
    const host = typeof data.host === 'string' ? data.host.trim() : ''
    if (token.length > 200 || !/^[\w-]*$/.test(token)) throw new Response('invalid project token', { status: 400 })
    if (host && !validSourceUrl(host)) throw new Response('host must be an http(s) URL', { status: 400 })
    const config: TelemetryConfig = { token, host: host || 'https://us.i.posthog.com' }
    instance.repository.setSetting('telemetry', config)
    await resetApp()
    return config
  }))

export const getBoardSettings = createServerFn({ method: 'GET' }).handler(async () => rpc(async () => {
  const instance = await app()
  if (instance.auth.require().role !== 'operator') throw new Response('forbidden', { status: 403 })
  return resolveBoardConfig(instance.repository)
}))

export const updateBoardSettings = createServerFn({ method: 'POST' })
  .validator((data: { privateRequests: boolean }) => data)
  .handler(async ({ data }) => rpc(async () => {
    const instance = await app()
    requireMutationOrigin(instance.authConfig.provider)
    if (instance.auth.require().role !== 'operator') throw new Response('forbidden', { status: 403 })
    const config = { privateRequests: data.privateRequests === true }
    instance.repository.setSetting('board', config)
    // Boards refetch over SSE so requesters' views update immediately.
    instance.events.publish('board.changed')
    return config
  }))

export const getAuthSettings = createServerFn({ method: 'GET' }).handler(async () => rpc(async () => {
  const instance = await app()
  if (instance.auth.require().role !== 'operator') throw new Response('forbidden', { status: 403 })
  return maskAuth(instance.authConfig)
}))

export const updateAuthSettings = createServerFn({ method: 'POST' })
  .validator((data: { provider: 'local' | 'trusted-header'; emailHeader?: string; proxySecret?: string; operatorEmails?: string }) => data)
  .handler(async ({ data }) => rpc(async () => {
    const instance = await app()
    requireMutationOrigin(instance.authConfig.provider)
    if (instance.auth.require().role !== 'operator') throw new Response('forbidden', { status: 403 })

    if (data.provider === 'local') {
      if (instance.repository.countOperatorsWithPassword() === 0) {
        throw new Response('no operator account has a password yet; add one in Users first so someone can sign in', { status: 409 })
      }
      instance.repository.setSetting('auth', { provider: 'local' })
      await resetApp()
      return { provider: 'local' as const }
    }

    if (data.provider !== 'trusted-header') throw new Response('unknown auth provider', { status: 400 })
    const current = instance.authConfig
    const emailHeader = (data.emailHeader ?? '').trim() || 'Cf-Access-Authenticated-User-Email'
    if (!/^[A-Za-z0-9-]{1,64}$/.test(emailHeader)) throw new Response('invalid header name', { status: 400 })
    // A blank secret keeps the currently saved one so edits never echo it.
    const proxySecret = data.proxySecret || (current.provider === 'trusted-header' ? current.proxySecret : '')
    if (typeof proxySecret !== 'string' || proxySecret.length < 24 || proxySecret.length > 512) {
      throw new Response('proxy secret must be 24 to 512 characters', { status: 400 })
    }
    const operatorEmails = (data.operatorEmails ?? '').split(/[\s,]+/).map((value) => value.trim().toLowerCase()).filter(Boolean)
    if (!operatorEmails.length || operatorEmails.some((email) => email.length > 254 || !/^\S+@\S+\.\S+$/.test(email))) {
      throw new Response('list at least one valid operator email', { status: 400 })
    }

    // Lockout guard: the request enabling trusted-header must itself have come
    // through the proxy, or the operator locks everyone (including themselves) out.
    const providedSecret = getRequestHeader('X-PrintHub-Proxy-Secret') ?? ''
    const providedEmail = getRequestHeader(emailHeader)?.toLowerCase() ?? ''
    if (providedSecret !== proxySecret || !operatorEmails.includes(providedEmail)) {
      throw new Response('this request did not arrive through the authenticating proxy with a matching secret and an operator email header; put PrintHub behind the proxy first, then save', { status: 400 })
    }

    const config: AuthConfig = { provider: 'trusted-header', emailHeader, proxySecret, operatorEmails }
    instance.repository.setSetting('auth', config)
    await resetApp()
    return maskAuth(config)
  }))

export const getStorageSettings = createServerFn({ method: 'GET' }).handler(async () => rpc(async () => {
  const instance = await app()
  if (instance.auth.require().role !== 'operator') throw new Response('forbidden', { status: 403 })
  return maskStorage(instance.storage)
}))

export const updateStorageSettings = createServerFn({ method: 'POST' })
  .validator((data: StorageConfig) => data)
  .handler(async ({ data }) => rpc(async () => {
    const instance = await app()
    requireMutationOrigin(instance.authConfig.provider)
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
  .handler(async ({ data }) => rpc(async () => { const instance = await app(); requireMutationOrigin(instance.authConfig.provider); return instance.service.moveCopies(data, instance.auth.require()) }))

export const reorderRequest = createServerFn({ method: 'POST' })
  .validator((data: { id: string; status: string; order: number }) => data)
  .handler(async ({ data }) => rpc(async () => { const instance = await app(); requireMutationOrigin(instance.authConfig.provider); return instance.service.reorder(data.id, data.status, data.order, instance.auth.require()) }))

export const updateRequest = createServerFn({ method: 'POST' })
  .validator((data: { id: string; name?: string; quantity?: number; requesterName?: string; notes?: string; sourceUrl?: string }) => data)
  .handler(async ({ data }) => rpc(async () => {
    const instance = await app()
    requireMutationOrigin(instance.authConfig.provider)
    const { id, ...fields } = data
    instance.service.update(id, fields, instance.auth.require())
  }))

export const deleteRequest = createServerFn({ method: 'POST' })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => rpc(async () => { const instance = await app(); requireMutationOrigin(instance.authConfig.provider); return instance.service.remove(data.id, instance.auth.require()) }))
