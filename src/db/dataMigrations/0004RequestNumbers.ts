import { and, asc, eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { DataMigration } from './types'

// Every column is named explicitly: drizzle caches key-derived names per table name, so a key-named column here would
// hide the live schema's other `requests` columns for the rest of the process.
const requests = sqliteTable('requests', {
  id: text('id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  number: integer('number'),
  createdAt: integer('created_at').notNull(),
})

const organization = sqliteTable('organization', {
  id: text('id').notNull(),
  lastRequestNumber: integer('last_request_number').notNull(),
})

/**
 * Numbers each workspace's existing requests from 1 in the order they were made, so every request has its `SQ-<number>`
 * tag, and starts the workspace's counter after the last of them.
 */
export const requestNumbersMigration: DataMigration = {
  id: '0004_request_numbers',
  after: 'request_numbers',
  async run(database) {
    const rows = await database
      .select({ id: requests.id, workspaceId: requests.workspaceId })
      .from(requests)
      .orderBy(asc(requests.workspaceId), asc(requests.createdAt), asc(requests.id))
      .all()
    const next = new Map<string, number>()
    for (const row of rows) {
      const number = (next.get(row.workspaceId) ?? 0) + 1
      next.set(row.workspaceId, number)
      await database
        .update(requests)
        .set({ number })
        .where(and(eq(requests.workspaceId, row.workspaceId), eq(requests.id, row.id)))
        .run()
    }
    for (const [workspaceId, lastRequestNumber] of next) {
      await database.update(organization).set({ lastRequestNumber }).where(eq(organization.id, workspaceId)).run()
    }
  },
}
