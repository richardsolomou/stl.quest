import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export const statusValidator = v.union(v.literal('todo'), v.literal('in_progress'), v.literal('done'))

const perStatusNumber = { todo: v.number(), in_progress: v.number(), done: v.number() }
const perStatusOrder = {
  todo: v.optional(v.number()),
  in_progress: v.optional(v.number()),
  done: v.optional(v.number()),
}

export default defineSchema({
  jobs: defineTable({
    name: v.string(),
    fileName: v.string(),
    filePath: v.string(),
    quantity: v.number(),
    requesterEmail: v.string(),
    requesterName: v.optional(v.string()),
    // Copies flow through the board individually: per-column counts sum to quantity.
    counts: v.object(perStatusNumber),
    orders: v.object(perStatusOrder),
    notes: v.optional(v.string()),
    thumbnail: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }),

  users: defineTable({
    email: v.string(),
    name: v.string(),
    color: v.optional(v.string()),
  }).index('by_email', ['email']),
})
