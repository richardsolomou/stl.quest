import fs from 'node:fs'
import path from 'node:path'
import postgres from 'postgres'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PostgreSQLBackend } from '../backends/postgres'
import { SQLiteBackend } from '../backends/sqlite'
import { createDatabase } from '../connection'
import { DrizzleRepository } from '../repository'
import { dataMigrations as applied, organization, requests, settings, user } from '../schema'
import type { DatabaseBackend } from '../backend'
import type { STLQuestDatabase } from '../connection'
import type { Consumable } from '../../core/consumables'
import type { EquipmentItem } from '../../core/equipment'
import type { PrinterProfile } from '../../core/types'
import type { UsageEvent } from '../../core/usage'
import { dataMigrations, runMigrations } from '.'
import { inventoryTablesMigration } from './0002InventoryTables'
import type { DataMigration, MigrationLog } from './types'

const silent = (): MigrationLog => ({ info: vi.fn(), warn: vi.fn() })

describe('data migration registry', () => {
  let backend: SQLiteBackend

  afterEach(() => backend.close())

  async function migrated() {
    backend = new SQLiteBackend(createDatabase(':memory:'))
    await backend.initialize(silent())
    await backend.database.delete(applied).run()
    return backend.database
  }

  function migration(
    id: string,
    calls: string[],
    run: (database: Parameters<DataMigration['run']>[0]) => Promise<void> = async () => undefined,
  ) {
    return {
      id,
      after: 'inventory',
      async run(database) {
        calls.push(id)
        await run(database)
      },
    } satisfies DataMigration
  }

  function schemaSpy(calls: string[]) {
    return { migrateSchema: async (through?: string) => void calls.push(`schema:${through ?? 'all'}`) }
  }

  it('runs each pending migration after the schema migration it follows, then the rest of the schema', async () => {
    const database = await migrated()
    const calls: string[] = []

    await runMigrations(schemaSpy(calls), database, silent(), [migration('0001_first', calls), migration('0002_second', calls)])

    expect(calls).toEqual(['schema:inventory', '0001_first', 'schema:inventory', '0002_second', 'schema:all'])
  })

  it('runs each migration once', async () => {
    const database = await migrated()
    const calls: string[] = []
    const migrations = [migration('0001_first', calls), migration('0002_second', calls)]

    await runMigrations(schemaSpy([]), database, silent(), migrations)
    await runMigrations(schemaSpy([]), database, silent(), migrations)

    expect(calls).toEqual(['0001_first', '0002_second'])
  })

  it('stops at a failure and retries from it on the next start', async () => {
    const database = await migrated()
    const calls: string[] = []
    let broken = true
    const migrations = [
      migration('0001_first', calls),
      migration('0002_second', calls, async () => {
        if (broken) throw new Error('migration failed')
      }),
      migration('0003_third', calls),
    ]

    await expect(runMigrations(schemaSpy([]), database, silent(), migrations)).rejects.toThrow('migration failed')
    broken = false
    await runMigrations(schemaSpy([]), database, silent(), migrations)

    expect(calls).toEqual(['0001_first', '0002_second', '0002_second', '0003_third'])
  })

  it('rolls back what a failed migration wrote', async () => {
    const database = await migrated()
    await database.insert(organization).values({ id: 'farm', name: 'Farm', slug: 'farm', createdAt: new Date() }).run()
    const failing = migration('0001_first', [], async (tx) => {
      await tx.insert(settings).values({ workspaceId: 'farm', key: 'half-done', valueJson: 'true', updatedAt: 0 }).run()
      throw new Error('migration failed')
    })

    await expect(runMigrations(schemaSpy([]), database, silent(), [failing])).rejects.toThrow('migration failed')

    expect({
      settings: await database.select().from(settings).all(),
      applied: await database.select().from(applied).all(),
    }).toEqual({ settings: [], applied: [] })
  })

  it('refuses a registry that is out of order', async () => {
    const database = await migrated()

    await expect(
      runMigrations(schemaSpy([]), database, silent(), [migration('0002_second', []), migration('0001_first', [])]),
    ).rejects.toThrow('data migrations must be appended in order')
  })

  it('follows schema migrations that both dialects have, in the order they were generated', () => {
    for (const folder of ['drizzle', 'drizzle-postgres']) {
      const journal = JSON.parse(fs.readFileSync(path.resolve(folder, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] }
      const names = journal.entries.map(({ tag }) => tag.replace(/^\d+_/, ''))
      const positions = dataMigrations.map(({ after }) => names.indexOf(after))

      expect(positions.every((position, index) => position >= 0 && position >= (positions[index - 1] ?? 0))).toBe(true)
    }
  })
})

const backends = process.env.POSTGRES_TEST_URL ? (['sqlite', 'postgres'] as const) : (['sqlite'] as const)

const resin: PrinterProfile = { id: 'saturn', name: 'Saturn', printType: 'resin', widthMm: 200, depthMm: 120, heightMm: 200 }
const filament: PrinterProfile = { id: 'mk4', name: 'MK4', printType: 'filament', archived: true }
const wash: EquipmentItem = {
  id: 'wash',
  name: 'Wash station',
  kind: 'wash',
  stage: 'finishing',
  powerWatts: 50,
  minutesPerUse: 10,
  supplies: [{ consumableId: 'ipa', amountPerUse: 200 }],
}
const library: Consumable[] = [
  { id: 'grey', kind: 'resin', name: 'Grey', pricePerLitre: 30, densityGramsPerMl: 1.1, minimumStock: 500 },
  { id: 'pla', kind: 'filament', name: 'PLA', pricePerKg: 20, colour: { name: 'Black', hex: '#000000' } },
  { id: 'ipa', kind: 'supply', name: 'IPA', unit: 'ml', price: 8 },
  { id: 'tank', kind: 'part', name: 'Tank', printType: 'resin', price: 40, lifespan: 1_000, lifespanUnit: 'plates', printerId: 'saturn' },
]

describe.each(backends)('upgrading stored inventory (%s)', (dialect) => {
  let backend: DatabaseBackend<STLQuestDatabase>
  let repository: DrizzleRepository

  afterEach(async () => await repository?.close())

  /** A database as the last release left it: every schema migration before the inventory tables, and a workspace. */
  async function released() {
    if (dialect === 'postgres') {
      const url = process.env.POSTGRES_TEST_URL!
      if (!new URL(url).pathname.endsWith('_test')) throw new Error('POSTGRES_TEST_URL must name a database ending in _test')
      const client = postgres(url, { max: 1, onnotice: () => undefined })
      await client`DROP SCHEMA public CASCADE`
      await client`DROP SCHEMA IF EXISTS drizzle CASCADE`
      await client`CREATE SCHEMA public`
      await client.end()
    }
    backend =
      dialect === 'postgres' ? PostgreSQLBackend.open(process.env.POSTGRES_TEST_URL!) : new SQLiteBackend(createDatabase(':memory:'))
    await backend.migrateSchema('usage_events')
    repository = await DrizzleRepository.create(backend, { initialize: false })
    const now = new Date()
    await backend.database.insert(organization).values({ id: 'farm', name: 'Farm', slug: 'farm', createdAt: now }).run()
    await backend.database
      .insert(user)
      .values({
        id: 'maker',
        name: 'Maker',
        email: 'maker@example.com',
        emailVerified: true,
        role: 'requester',
        createdAt: now,
        updatedAt: now,
      })
      .run()
    return await repository.scoped('farm')
  }

  async function print(id: string, printerId?: string) {
    await backend.database
      .insert(requests)
      .values({
        id,
        workspaceId: 'farm',
        name: id,
        fileName: `${id}.stl`,
        filePath: `${id}.stl`,
        quantity: 1,
        ownerUserId: 'maker',
        printerId,
        createdAt: 0,
        updatedAt: 0,
      })
      .run()
  }

  function usage(id: string, fields: Partial<UsageEvent>): UsageEvent {
    return { id, transactionId: id, stage: 'printing', kind: 'use', amount: 1, unit: 'minute', createdAt: 0, ...fields }
  }

  async function upgrade(log = silent()) {
    await backend.initialize(log)
    return await repository.scoped('farm')
  }

  it('copies printers, equipment, and consumables in their stored order', async () => {
    const workspace = await released()
    await workspace.setSettings({ printers: [resin, filament], equipment: [wash], consumables: library })

    const upgraded = await upgrade()

    expect({
      printers: await upgraded.listInventory('printers'),
      equipment: await upgraded.listInventory('equipment'),
      consumables: await upgraded.listInventory('consumables'),
    }).toEqual({ printers: [resin, filament], equipment: [wash], consumables: library })
  })

  it('removes the settings it copied', async () => {
    const workspace = await released()
    await workspace.setSettings({ printers: [resin], equipment: [wash], consumables: library })

    const upgraded = await upgrade()

    expect([
      await upgraded.getSetting('printers'),
      await upgraded.getSetting('equipment'),
      await upgraded.getSetting('consumables'),
    ]).toEqual([undefined, undefined, undefined])
  })

  it('remembers printer setup that finished without a printer', async () => {
    const workspace = await released()
    await workspace.setSetting('printers', [])

    expect(await (await upgrade()).getSetting('printers-skipped')).toBe(true)
  })

  it('clears references to items that were no longer stored, and logs them', async () => {
    const workspace = await released()
    await workspace.setSettings({ printers: [resin], equipment: [wash], consumables: library })
    await print('kept', 'saturn')
    await print('orphaned', 'removed-printer')
    await workspace.appendUsageEvents([
      usage('printing', { printerId: 'removed-printer', consumableId: 'removed-resin', unit: 'ml' }),
      usage('washing', { equipmentId: 'removed-wash', stage: 'finishing' }),
      usage('tracked', { printerId: 'saturn', consumableId: 'grey', unit: 'ml' }),
    ])
    const log = silent()

    const upgraded = await upgrade(log)

    expect({
      prints: (await upgraded.listRequests()).map(({ id, printerId }) => ({ id, printerId })).sort((a, b) => a.id.localeCompare(b.id)),
      usage: (await upgraded.listUsage({})).map(({ id, printerId, equipmentId, consumableId }) => ({
        id,
        printerId,
        equipmentId,
        consumableId,
      })),
      cleared: vi
        .mocked(log.warn)
        .mock.calls.map(([fields]) => fields)
        .filter(({ event }) => event === 'data_migration_reference_cleared'),
    }).toEqual({
      prints: [
        { id: 'kept', printerId: 'saturn' },
        { id: 'orphaned', printerId: undefined },
      ],
      usage: expect.arrayContaining([
        { id: 'printing', printerId: undefined, equipmentId: undefined, consumableId: undefined },
        { id: 'washing', printerId: undefined, equipmentId: undefined, consumableId: undefined },
        { id: 'tracked', printerId: 'saturn', equipmentId: undefined, consumableId: 'grey' },
      ]),
      cleared: [
        { event: 'data_migration_reference_cleared', workspace_id: 'farm', table: 'requests', column: 'printer_id', count: 1 },
        { event: 'data_migration_reference_cleared', workspace_id: 'farm', table: 'usage_events', column: 'printer_id', count: 1 },
        { event: 'data_migration_reference_cleared', workspace_id: 'farm', table: 'usage_events', column: 'equipment_id', count: 1 },
        { event: 'data_migration_reference_cleared', workspace_id: 'farm', table: 'usage_events', column: 'consumable_id', count: 1 },
      ],
    })
  })

  it('holds every reference to inventory to an item the workspace has once it upgrades', async () => {
    await released()
    await upgrade()

    await expect(print('misassigned', 'removed-printer')).rejects.toThrow()
  })

  it('changes nothing when its copy runs again', async () => {
    const workspace = await released()
    await workspace.setSettings({ printers: [resin, filament], equipment: [wash], consumables: library })
    const upgraded = await upgrade()

    await backend.database.transaction(async (tx) => await inventoryTablesMigration.run(tx, silent()))

    expect(await upgraded.listInventory('printers')).toEqual([resin, filament])
  })

  it('applies each data migration once across restarts', async () => {
    const workspace = await released()
    await workspace.setSettings({ printers: [resin] })
    await upgrade()

    await upgrade()

    expect({
      applied: (await backend.database.select({ id: applied.id }).from(applied).all()).map(({ id }) => id),
      printers: await (await repository.scoped('farm')).listInventory('printers'),
    }).toEqual({ applied: ['0001_legacy_costing', '0002_inventory_tables'], printers: [resin] })
  })

  it('creates no printers for a workspace whose v1.52 costing never saved any', async () => {
    const workspace = await released()
    await workspace.setSetting('price_calculator', { currency: 'GBP', resinPricePerLitre: 32, equipmentCostPerHour: 2 })

    const upgraded = await upgrade()

    expect({
      printers: await upgraded.listInventory('printers'),
      skipped: await upgraded.getSetting('printers-skipped'),
      materials: (await upgraded.listInventory('consumables')).map(({ id }) => id),
    }).toEqual({ printers: [], skipped: undefined, materials: ['legacy-resin'] })
  })

  it('upgrades v1.52 costing before the copy, so the material most printers priced with comes first', async () => {
    const workspace = await released()
    const elegoo = { ...resin, id: 'elegoo', name: 'Elegoo' }
    await workspace.setSettings({
      price_calculator: {
        currency: 'GBP',
        resinPricePerLitre: 50,
        resinDensityGramsPerMl: 1.1,
        equipmentCostPerHour: 0.4,
        printerCosts: { saturn: { resinPricePerLitre: 32 }, elegoo: { resinPricePerLitre: 32 } },
      },
      printers: [resin, elegoo],
      consumables: [{ id: 'grey', kind: 'resin', name: 'Grey', pricePerLitre: 30, densityGramsPerMl: 1.1 }],
    })

    const upgraded = await upgrade()

    expect({
      priceCalculator: await upgraded.getSetting('price_calculator'),
      wear: (await upgraded.listInventory('printers')).map(({ purchasePrice, lifespanHours }) => ({ purchasePrice, lifespanHours })),
      materials: (await upgraded.listInventory('consumables')).map(({ id }) => id),
    }).toEqual({
      priceCalculator: { currency: 'GBP' },
      wear: [
        { purchasePrice: 400, lifespanHours: 1_000 },
        { purchasePrice: 400, lifespanHours: 1_000 },
      ],
      materials: ['legacy-resin-saturn', 'grey', 'legacy-resin'],
    })
  })
})
