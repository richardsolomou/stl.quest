import { createServerFn } from '@tanstack/react-start'
import { app } from './app'
import { workflow } from '../core/workflow'
import { hashPassword } from '../adapters/auth'
import { requireMutationOrigin } from './mutationOrigin'

export const sessionInfo = createServerFn({ method: 'GET' }).handler(async () => {
  const instance = await app()
  const identity = instance.auth.current()
  return {
    identity,
    setupRequired: process.env.AUTH_PROVIDER !== 'trusted-header' && instance.repository.countUsers() === 0,
    authProvider: process.env.AUTH_PROVIDER ?? 'local',
    workflow,
  }
})

export const setupOperator = createServerFn({ method: 'POST' })
  .validator((data: { email: string; name: string; password: string }) => data)
  .handler(async ({ data }) => { requireMutationOrigin(); return (await app()).auth.setup(data) })

export const login = createServerFn({ method: 'POST' })
  .validator((data: { email: string; password: string }) => data)
  .handler(async ({ data }) => { requireMutationOrigin(); return (await app()).auth.login(data) })

export const logout = createServerFn({ method: 'POST' }).handler(async () => { requireMutationOrigin(); return (await app()).auth.logout() })

export const changePassword = createServerFn({ method: 'POST' })
  .validator((data: { currentPassword: string; newPassword: string }) => data)
  .handler(async ({ data }) => { requireMutationOrigin(); return (await app()).auth.changePassword(data) })

export const createUser = createServerFn({ method: 'POST' })
  .validator((data: { email: string; name: string; password: string; role: 'requester' | 'operator' }) => data)
  .handler(async ({ data }) => {
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
  })

export const listRequests = createServerFn({ method: 'GET' }).handler(async () => {
  const instance = await app()
  return instance.service.listRequests(instance.auth.require())
})

export const listPeople = createServerFn({ method: 'GET' }).handler(async () => {
  const instance = await app()
  instance.auth.require()
  return instance.service.listPeople()
})

export const moveCopies = createServerFn({ method: 'POST' })
  .validator((data: { id: string; from: string; to: string; count: number; order?: number }) => data)
  .handler(async ({ data }) => { requireMutationOrigin(); const instance = await app(); return instance.service.moveCopies(data, instance.auth.require()) })

export const reorderRequest = createServerFn({ method: 'POST' })
  .validator((data: { id: string; status: string; order: number }) => data)
  .handler(async ({ data }) => { requireMutationOrigin(); const instance = await app(); return instance.service.reorder(data.id, data.status, data.order, instance.auth.require()) })

export const updateRequest = createServerFn({ method: 'POST' })
  .validator((data: { id: string; name?: string; quantity?: number; requesterName?: string; notes?: string; sourceUrl?: string }) => data)
  .handler(async ({ data }) => {
    requireMutationOrigin()
    const { id, ...fields } = data
    const instance = await app()
    instance.service.update(id, fields, instance.auth.require())
  })

export const deleteRequest = createServerFn({ method: 'POST' })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => { requireMutationOrigin(); const instance = await app(); return instance.service.remove(data.id, instance.auth.require()) })
