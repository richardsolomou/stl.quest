import { mutation, query } from './_generated/server'
import { v } from 'convex/values'

export const byEmail = query({
  args: { email: v.string() },
  handler: (ctx, { email }) =>
    ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', email.toLowerCase()))
      .unique(),
})

export const upsert = mutation({
  args: { secret: v.string(), email: v.string(), name: v.string() },
  handler: async (ctx, { secret, email, name }) => {
    if (!process.env.APP_WRITE_SECRET || secret !== process.env.APP_WRITE_SECRET) {
      throw new Error('unauthorized')
    }
    const normalized = email.toLowerCase()
    const existing = await ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', normalized))
      .unique()
    if (existing) await ctx.db.patch(existing._id, { name })
    else await ctx.db.insert('users', { email: normalized, name })
  },
})
