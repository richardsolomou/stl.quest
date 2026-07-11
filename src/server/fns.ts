import fs from 'node:fs'
import { createServerFn } from '@tanstack/react-start'
import type { Id } from '../../convex/_generated/dataModel'
import { api } from '../../convex/_generated/api'
import { STATUSES, type Status } from '../../convex/statuses'
import { convex, writeSecret } from './convexServer'
import { isAdmin, readUserEmail, requireAdmin } from './identity'
import { absolutePath, fileStatus, moveToStatusFolder } from './files'

export const whoami = createServerFn({ method: 'GET' }).handler(async () => {
  const email = readUserEmail()
  const user = await convex().query(api.users.byEmail, { email })
  return { email, name: user?.name ?? email.split('@')[0], isAdmin: isAdmin(email) }
})

export const moveCopies = createServerFn({ method: 'POST' })
  .validator((data: { id: string; from: Status; to: Status; count: number; order?: number }) => {
    if (!STATUSES.includes(data.from) || !STATUSES.includes(data.to) || data.from === data.to) {
      throw new Error('invalid move')
    }
    if (!Number.isInteger(data.count) || data.count < 1) throw new Error('invalid count')
    if (data.order !== undefined && !Number.isFinite(data.order)) throw new Error('invalid order')
    return data
  })
  .handler(async ({ data }) => {
    requireAdmin()
    const id = data.id as Id<'jobs'>
    const job = await convex().query(api.jobs.get, { id })
    if (!job) throw new Response('not found', { status: 404 })
    if (job.counts[data.from] < data.count) throw new Response('not enough copies', { status: 409 })

    const nextCounts = {
      ...job.counts,
      [data.from]: job.counts[data.from] - data.count,
      [data.to]: job.counts[data.to] + data.count,
    }
    const targetFolder = fileStatus(nextCounts)
    const filePath =
      targetFolder === fileStatus(job.counts) ? job.filePath : await moveToStatusFolder(job.filePath, targetFolder)

    await convex().mutation(api.jobs.moveCopies, {
      secret: writeSecret(),
      id,
      from: data.from,
      to: data.to,
      count: data.count,
      filePath,
      order: data.order,
    })
  })

export const reorderJob = createServerFn({ method: 'POST' })
  .validator((data: { id: string; status: Status; order: number }) => {
    if (!STATUSES.includes(data.status) || !Number.isFinite(data.order)) throw new Error('invalid')
    return data
  })
  .handler(async ({ data }) => {
    requireAdmin()
    await convex().mutation(api.jobs.reorder, {
      secret: writeSecret(),
      id: data.id as Id<'jobs'>,
      status: data.status,
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
      // Requesters may adjust copies/notes on their own job, but only before any copy starts.
      const job = await convex().query(api.jobs.get, { id: id as Id<'jobs'> })
      if (!job || job.requesterEmail !== email) throw new Response('forbidden', { status: 403 })
      if (job.counts.in_progress > 0 || job.counts.done > 0) {
        throw new Response('job already started', { status: 409 })
      }
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
