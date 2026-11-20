import { and, eq, inArray } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { Consumable } from '../../core/consumables'
import { upgradeLegacyCosting } from '../../core/legacyCosting'
import type { PrinterProfile } from '../../core/types'
import type { DataMigration } from './types'

const settings = sqliteTable('settings', {
  workspaceId: text('workspace_id').notNull(),
  key: text().notNull(),
  valueJson: text('value_json').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

const PRICE_CALCULATOR = 'price_calculator'
const PRINTERS = 'printers'
const CONSUMABLES = 'consumables'

/**
 * Moves what v1.51 and v1.52 kept per printer in the calculator settings onto printers and library materials, still as
 * settings JSON, touching only the keys it changes so a workspace that never saved printers or consumables keeps them unsaved.
 */
export const legacyCostingMigration: DataMigration = {
  id: '0001_legacy_costing',
  after: 'inventory',
  async run(database) {
    const rows = await database
      .select()
      .from(settings)
      .where(inArray(settings.key, [PRICE_CALCULATOR, PRINTERS, CONSUMABLES]))
      .all()
    const workspaces = new Map<string, Map<string, unknown>>()
    for (const row of rows) {
      const stored = workspaces.get(row.workspaceId) ?? new Map<string, unknown>()
      stored.set(row.key, JSON.parse(row.valueJson))
      workspaces.set(row.workspaceId, stored)
    }
    for (const [workspaceId, stored] of workspaces) {
      const priceCalculator = stored.get(PRICE_CALCULATOR) as Record<string, unknown> | undefined
      if (!priceCalculator) continue
      const printers = stored.get(PRINTERS) as PrinterProfile[] | undefined
      const consumables = stored.get(CONSUMABLES) as Consumable[] | undefined
      const upgraded = upgradeLegacyCosting({ priceCalculator, printers: printers ?? [], consumables: consumables ?? [] })
      if (!upgraded) continue
      const changed = (previous: unknown, next: unknown[]) => JSON.stringify(previous ?? []) !== JSON.stringify(next)
      const writes: [string, unknown][] = [
        [PRICE_CALCULATOR, upgraded.priceCalculator],
        ...(changed(printers, upgraded.printers) ? [[PRINTERS, upgraded.printers] as [string, unknown]] : []),
        ...(changed(consumables, upgraded.consumables) ? [[CONSUMABLES, upgraded.consumables] as [string, unknown]] : []),
      ]
      for (const [key, value] of writes) {
        const values = { workspaceId, key, valueJson: JSON.stringify(value), updatedAt: Date.now() }
        if (stored.has(key))
          await database
            .update(settings)
            .set(values)
            .where(and(eq(settings.workspaceId, workspaceId), eq(settings.key, key)))
            .run()
        else await database.insert(settings).values(values).run()
      }
    }
  },
}
