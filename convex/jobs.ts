import { mutation, query } from './_generated/server'
import { v } from 'convex/values'
import { statusValidator } from './schema'

function assertSecret(secret: string) {
  if (!process.env.APP_WRITE_SECRET || secret !== process.env.APP_WRITE_SECRET) {
    throw new Error('unauthorized')
  }
}

export const list = query({
  args: {},
  handler: (ctx) => ctx.db.query('jobs').order('desc').collect(),
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
  },
  handler: async (ctx, { secret, ...job }) => {
    assertSecret(secret)
    const now = Date.now()
    return ctx.db.insert('jobs', {
      ...job,
      status: 'todo',
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const move = mutation({
  args: {
    secret: v.string(),
    id: v.id('jobs'),
    status: statusValidator,
    filePath: v.string(),
    order: v.optional(v.number()),
  },
  handler: async (ctx, { secret, id, status, filePath, order }) => {
    assertSecret(secret)
    await ctx.db.patch(id, {
      status,
      filePath,
      updatedAt: Date.now(),
      ...(order !== undefined ? { order } : {}),
    })
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
  handler: async (ctx, { secret, id, ...fields }) => {
    assertSecret(secret)
    const patch = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
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
