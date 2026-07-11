import { createServerFn } from '@tanstack/react-start'
import type { Id } from '../../convex/_generated/dataModel'
import { api } from '../../convex/_generated/api'
import { STATUSES, type Printer, type Status } from '../../convex/statuses'
import { convex, writeSecret } from './convexServer'
import { isAdmin, readUserEmail, requireAdmin } from './identity'
import { moveToStatusFolder } from './files'

export const whoami = createServerFn({ method: 'GET' }).handler(() => {
  const email = readUserEmail()
  return { email, isAdmin: isAdmin(email) }
})

export const moveJob = createServerFn({ method: 'POST' })
  .validator((data: { id: string; status: Status }) => {
    if (!STATUSES.includes(data.status)) throw new Error('invalid status')
    return data
  })
  .handler(async ({ data }) => {
    requireAdmin()
    const id = data.id as Id<'jobs'>
    const job = await convex().query(api.jobs.get, { id })
    if (!job) throw new Response('not found', { status: 404 })
    if (job.status === data.status) return
    const filePath = await moveToStatusFolder(job.filePath, data.status)
    await convex().mutation(api.jobs.move, { secret: writeSecret(), id, status: data.status, filePath })
  })

export const updateJob = createServerFn({ method: 'POST' })
  .validator(
    (data: {
      id: string
      name?: string
      quantity?: number
      printer?: Printer
      tags?: string[]
      notes?: string
    }) => data,
  )
  .handler(async ({ data }) => {
    requireAdmin()
    const { id, ...fields } = data
    await convex().mutation(api.jobs.update, { secret: writeSecret(), id: id as Id<'jobs'>, ...fields })
  })

export const deleteJob = createServerFn({ method: 'POST' })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    requireAdmin()
    await convex().mutation(api.jobs.remove, { secret: writeSecret(), id: data.id as Id<'jobs'> })
  })
