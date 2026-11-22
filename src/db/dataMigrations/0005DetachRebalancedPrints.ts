import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { DataMigration } from './types'

// Every column is named explicitly: drizzle caches key-derived names per table name, so a key-named column here would
// hide the live schema's other columns for the rest of the process.
const printers = sqliteTable('printers', {
  id: text('id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  printType: text('print_type').notNull(),
  archivedAt: integer('archived_at'),
})

const requests = sqliteTable('requests', {
  id: text('id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  printerId: text('printer_id'),
  printType: text('print_type'),
  automaticPrinterAssignment: integer('automatic_printer_assignment').notNull(),
  archivedAt: integer('archived_at'),
})

const requestStatuses = sqliteTable('request_statuses', {
  workspaceId: text('workspace_id').notNull(),
  requestId: text('request_id').notNull(),
  statusId: text('status_id').notNull(),
  quantity: integer('quantity').notNull(),
})

const usageEvents = sqliteTable('usage_events', {
  workspaceId: text('workspace_id').notNull(),
  requestId: text('request_id'),
  printerId: text('printer_id'),
  estimated: integer('estimated').notNull(),
})

/** The workflow's last status when this migration was written; copies there are printed. */
const READY = 'done'
const BATCH = 500

/**
 * Every start used to rebalance automatically assigned prints across a workspace's printers of their type, including
 * prints already made, so once a workspace had two such printers a past print's printer, and the estimated usage
 * filled in from it, could name a machine it never ran on. Which one it did run on was never stored, so a past print
 * in that position loses its printer: it keeps its print type, and its estimated usage still counts as spend but no
 * longer as any printer's run. Prints assigned by hand, prints still to be made, and types with only one printer keep
 * theirs, since rebalancing could not have moved them.
 */
export const detachRebalancedPrintsMigration: DataMigration = {
  id: '0005_detach_rebalanced_prints',
  after: 'spoolman',
  async run(database, log) {
    const live = await database
      .select({ id: printers.id, workspaceId: printers.workspaceId, printType: printers.printType, archivedAt: printers.archivedAt })
      .from(printers)
      .all()
    // Rebalancing skipped prints on an archived printer, so only an active printer can hold one it moved.
    const printTypeOf = new Map(
      live.filter(({ archivedAt }) => archivedAt === null).map((printer) => [`${printer.workspaceId}:${printer.id}`, printer.printType]),
    )
    const activeByType = new Map<string, number>()
    for (const printer of live) {
      if (printer.archivedAt !== null) continue
      const key = `${printer.workspaceId}:${printer.printType}`
      activeByType.set(key, (activeByType.get(key) ?? 0) + 1)
    }

    const outstanding = new Set(
      (
        await database
          .select({
            workspaceId: requestStatuses.workspaceId,
            requestId: requestStatuses.requestId,
            statusId: requestStatuses.statusId,
            quantity: requestStatuses.quantity,
          })
          .from(requestStatuses)
          .all()
      )
        .filter(({ statusId, quantity }) => statusId !== READY && quantity > 0)
        .map(({ workspaceId, requestId }) => `${workspaceId}:${requestId}`),
    )

    const candidates = await database
      .select({ id: requests.id, workspaceId: requests.workspaceId, printerId: requests.printerId, archivedAt: requests.archivedAt })
      .from(requests)
      .where(and(eq(requests.automaticPrinterAssignment, 1), isNotNull(requests.printerId)))
      .all()
    const detached = candidates.flatMap((request) => {
      const printType = printTypeOf.get(`${request.workspaceId}:${request.printerId}`)
      const printed = request.archivedAt !== null || !outstanding.has(`${request.workspaceId}:${request.id}`)
      const rebalanceable = printType !== undefined && (activeByType.get(`${request.workspaceId}:${printType}`) ?? 0) > 1
      return printed && rebalanceable ? [{ ...request, printType }] : []
    })

    const byWorkspace = new Map<string, string[]>()
    for (const request of detached) {
      await database
        .update(requests)
        .set({ printerId: null, printType: request.printType })
        .where(and(eq(requests.workspaceId, request.workspaceId), eq(requests.id, request.id)))
        .run()
      byWorkspace.set(request.workspaceId, [...(byWorkspace.get(request.workspaceId) ?? []), request.id])
    }
    for (const [workspaceId, ids] of byWorkspace) {
      for (let start = 0; start < ids.length; start += BATCH) {
        await database
          .update(usageEvents)
          .set({ printerId: null })
          .where(
            and(
              eq(usageEvents.workspaceId, workspaceId),
              eq(usageEvents.estimated, 1),
              isNotNull(usageEvents.printerId),
              inArray(usageEvents.requestId, ids.slice(start, start + BATCH)),
            ),
          )
          .run()
      }
      log.info(
        { event: 'rebalanced_prints_detached', workspace_id: workspaceId, print_count: ids.length },
        'past prints detached from printers automatic assignment had moved them to',
      )
    }
  },
}
