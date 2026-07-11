import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export const statusValidator = v.union(v.literal('todo'), v.literal('in_progress'), v.literal('done'))

export default defineSchema({
  jobs: defineTable({
    name: v.string(),
    fileName: v.string(),
    filePath: v.string(),
    quantity: v.number(),
    requesterEmail: v.string(),
    requesterName: v.optional(v.string()),
    status: statusValidator,
    notes: v.optional(v.string()),
    thumbnail: v.optional(v.string()),
    order: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_status', ['status']),

  users: defineTable({
    email: v.string(),
    name: v.string(),
  }).index('by_email', ['email']),
})
