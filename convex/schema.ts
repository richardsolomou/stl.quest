import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export const statusValidator = v.union(v.literal('todo'), v.literal('in_progress'), v.literal('done'))
export const printerValidator = v.union(v.literal('resin'), v.literal('fdm'), v.literal('unassigned'))

export default defineSchema({
  jobs: defineTable({
    name: v.string(),
    fileName: v.string(),
    filePath: v.string(),
    quantity: v.number(),
    requesterEmail: v.string(),
    requesterName: v.optional(v.string()),
    tags: v.array(v.string()),
    printer: printerValidator,
    status: statusValidator,
    notes: v.optional(v.string()),
    thumbnail: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_status', ['status']),
})
