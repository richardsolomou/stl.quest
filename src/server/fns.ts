import fs from 'node:fs'
import { createServerFn } from '@tanstack/react-start'
import type { Id } from '../../convex/_generated/dataModel'
import { api } from '../../convex/_generated/api'
import { STATUSES, type Status } from '../../convex/statuses'
import { convex, writeSecret } from './convexServer'
import { isAdmin, readUserEmail, requireAdmin } from './identity'
import { absolutePath, moveToStatusFolder } from './files'

export const whoami = createServerFn({ method: 'GET' }).handler(() => {
  const email = readUserEmail()
  return { email, isAdmin: isAdmin(email) }
})

export const moveJob = createServerFn({ method: 'POST' })
  .validator((data: { id: string; status: Status; order?: number }) => {
    if (!STATUSES.includes(data.status)) throw new Error('invalid status')
    if (data.order !== undefined && !Number.isFinite(data.order)) throw new Error('invalid order')
    return data
  })
  .handler(async ({ data }) => {
    requireAdmin()
    const id = data.id as Id<'jobs'>
    const job = await convex().query(api.jobs.get, { id })
    if (!job) throw new Response('not found', { status: 404 })
    const filePath =
      job.status === data.status ? job.filePath : await moveToStatusFolder(job.filePath, data.status)
    await convex().mutation(api.jobs.move, {
      secret: writeSecret(),
      id,
      status: data.status,
      filePath,
      order: data.order,
    })
  })

export const updateJob = createServerFn({ method: 'POST' })
  .validator(
    (data: { id: string; name?: string; quantity?: number; requesterName?: string; notes?: string }) => data,
  )
  .handler(async ({ data }) => {
    const email = readUserEmail()
    const { id, ...fields } = data
    if (fields.quantity !== undefined) {
      fields.quantity = Math.min(50, Math.max(1, Math.round(fields.quantity)))
    }

    if (!isAdmin(email)) {
      // Requesters may adjust copies/notes on their own job, but only before it's started.
      const job = await convex().query(api.jobs.get, { id: id as Id<'jobs'> })
      if (!job || job.requesterEmail !== email) throw new Response('forbidden', { status: 403 })
      if (job.status !== 'todo') throw new Response('job already started', { status: 409 })
      const { quantity, notes } = fields
      await convex().mutation(api.jobs.update, { secret: writeSecret(), id: id as Id<'jobs'>, quantity, notes })
      return
    }

    await convex().mutation(api.jobs.update, { secret: writeSecret(), id: id as Id<'jobs'>, ...fields })
  })

export const deleteJob = createServerFn({ method: 'POST' })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    requireAdmin()
    const id = data.id as Id<'jobs'>
    const job = await convex().query(api.jobs.get, { id })
    if (!job) return
    await convex().mutation(api.jobs.remove, { secret: writeSecret(), id })
    await fs.promises.rm(absolutePath(job.filePath), { force: true })
  })
