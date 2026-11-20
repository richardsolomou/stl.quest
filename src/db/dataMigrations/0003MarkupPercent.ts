import { and, eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { DataMigration } from './types'

const settings = sqliteTable('settings', {
  workspaceId: text('workspace_id').notNull(),
  key: text().notNull(),
  valueJson: text('value_json').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

/**
 * Turns the calculator's margin, a share of the price, into the markup on cost that prices the same: a 25% margin is a
 * 33.33% markup. Two decimals keep the setting readable and move a price by well under a hundredth of a percent.
 */
export const markupPercentMigration: DataMigration = {
  id: '0003_markup_percent',
  after: 'inventory_references',
  async run(database) {
    const rows = await database.select().from(settings).where(eq(settings.key, 'price_calculator')).all()
    for (const row of rows) {
      const { standardMarginPercent: margin, ...rest } = JSON.parse(row.valueJson) as Record<string, unknown>
      if (typeof margin !== 'number') continue
      const clamped = Math.min(Math.max(margin, 0), 95)
      const markupPercent = Math.round((clamped / (100 - clamped)) * 100 * 100) / 100
      await database
        .update(settings)
        .set({ valueJson: JSON.stringify({ ...rest, markupPercent }), updatedAt: Date.now() })
        .where(and(eq(settings.workspaceId, row.workspaceId), eq(settings.key, row.key)))
        .run()
    }
  },
}
