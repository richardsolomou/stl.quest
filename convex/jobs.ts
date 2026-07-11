import { mutation, query } from './_generated/server'
import { v } from 'convex/values'
import { statusValidator } from './schema'

function assertSecret(secret: string) {
  if (!process.env.APP_WRITE_SECRET || secret !== process.env.APP_WRITE_SECRET) {
    throw new Error('unauthorized')
  }
}

// Thumbnails are heavy data-URLs; the board fetches them lazily over HTTP
// instead of carrying them in every realtime update.
export const list = query({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query('jobs').order('desc').collect()).map(({ thumbnail, ...job }) => ({
      ...job,
      hasThumbnail: thumbnail !== undefined,
    })),
})

export const get = query({
  args: { id: v.id('jobs') },
  handler: (ctx, { id }) => ctx.db.get(id),
})

export const create = mutation({
  args: {
    secret: v.string(),
    name: v.string(),
    fileName: v.string(),
    filePath: v.string(),
    quantity: v.number(),
    requesterEmail: v.string(),
    requesterName: v.optional(v.string()),
    notes: v.optional(v.string()),
    thumbnail: v.optional(v.string()),
    previewPath: v.optional(v.string()),
  },
  handler: async (ctx, { secret, ...job }) => {
    assertSecret(secret)
    const now = Date.now()
    return ctx.db.insert('jobs', {
      ...job,
      counts: { todo: job.quantity, in_progress: 0, done: 0 },
      orders: {},
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const moveCopies = mutation({
  args: {
    secret: v.string(),
    id: v.id('jobs'),
    from: statusValidator,
    to: statusValidator,
    count: v.number(),
    filePath: v.string(),
    order: v.optional(v.number()),
  },
  handler: async (ctx, { secret, id, from, to, count, filePath, order }) => {
    assertSecret(secret)
    const job = await ctx.db.get(id)
    if (!job) throw new Error('not found')
    if (from === to || !Number.isInteger(count) || count < 1 || job.counts[from] < count) {
      throw new Error('invalid move')
    }
    const counts = { ...job.counts, [from]: job.counts[from] - count, [to]: job.counts[to] + count }
    // A merge into an existing pile keeps that pile's position.
    const orders =
      job.counts[to] > 0 || order === undefined ? job.orders : { ...job.orders, [to]: order }
    await ctx.db.patch(id, { counts, orders, filePath, updatedAt: Date.now() })
  },
})

export const reorder = mutation({
  args: { secret: v.string(), id: v.id('jobs'), status: statusValidator, order: v.number() },
  handler: async (ctx, { secret, id, status, order }) => {
    assertSecret(secret)
    const job = await ctx.db.get(id)
    if (!job) throw new Error('not found')
    await ctx.db.patch(id, { orders: { ...job.orders, [status]: order }, updatedAt: Date.now() })
  },
})

export const update = mutation({
  args: {
    secret: v.string(),
    id: v.id('jobs'),
    name: v.optional(v.string()),
    quantity: v.optional(v.number()),
    requesterName: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { secret, id, quantity, ...fields }) => {
    assertSecret(secret)
    const patch = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
    if (quantity !== undefined) {
      const job = await ctx.db.get(id)
      if (!job) throw new Error('not found')
      const started = job.counts.in_progress + job.counts.done
      if (quantity < Math.max(started, 1)) throw new Error('cannot reduce below started copies')
      Object.assign(patch, { quantity, counts: { ...job.counts, todo: quantity - started } })
    }
    await ctx.db.patch(id, { ...patch, updatedAt: Date.now() })
  },
})

export const remove = mutation({
  args: { secret: v.string(), id: v.id('jobs') },
  handler: async (ctx, { secret, id }) => {
    assertSecret(secret)
    await ctx.db.delete(id)
  },
})
