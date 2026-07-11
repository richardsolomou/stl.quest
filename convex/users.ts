import { mutation, query } from './_generated/server'
import { v } from 'convex/values'

/** Well-separated hues, consistent saturation/lightness for the dark theme. */
export const PALETTE = [
  'hsl(168 48% 62%)', // teal
  'hsl(270 50% 70%)', // violet
  'hsl(345 55% 68%)', // rose
  'hsl(45 60% 60%)', // gold
  'hsl(205 55% 64%)', // sky
  'hsl(105 38% 60%)', // moss
  'hsl(20 60% 64%)', // clay
  'hsl(230 50% 72%)', // periwinkle
]

export const list = query({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query('users').collect())
      .map(({ name, color }) => ({ name, color }))
      .sort((a, b) => a.name.localeCompare(b.name)),
})

export const byEmail = query({
  args: { email: v.string() },
  handler: (ctx, { email }) =>
    ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', email.toLowerCase()))
      .unique(),
})

export const upsert = mutation({
  args: { secret: v.string(), email: v.string(), name: v.string(), color: v.optional(v.string()) },
  handler: async (ctx, { secret, email, name, color }) => {
    if (!process.env.APP_WRITE_SECRET || secret !== process.env.APP_WRITE_SECRET) {
      throw new Error('unauthorized')
    }
    const normalized = email.toLowerCase()
    const all = await ctx.db.query('users').collect()
    const existing = all.find((user) => user.email === normalized)
    const assigned =
      color ??
      existing?.color ??
      PALETTE.find((entry) => !all.some((user) => user.color === entry)) ??
      PALETTE[all.length % PALETTE.length]
    if (existing) await ctx.db.patch(existing._id, { name, color: assigned })
    else await ctx.db.insert('users', { email: normalized, name, color: assigned })
  },
})
