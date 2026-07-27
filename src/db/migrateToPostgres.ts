import { and, eq, getTableName, isNull, ne, type Table } from 'drizzle-orm'
import { schema } from './schema'
import { PostgreSQLBackend } from './backends/postgres'
import { SQLiteBackend } from './backends/sqlite'

const tables = [
  schema.user,
  schema.organization,
  schema.session,
  schema.member,
  schema.invitation,
  schema.account,
  schema.verification,
  schema.rateLimit,
  schema.twoFactor,
  schema.deploymentSettings,
  schema.settings,
  schema.assetMigrations,
  schema.invites,
  schema.requests,
  schema.requestStatuses,
  schema.printGroups,
  schema.printGroupItems,
  schema.operations,
  schema.uploadSessions,
  schema.assetGenerationJobs,
] as const

export async function migrateSQLiteToPostgreSQL(
  sourcePath: string,
  databaseUrl: string,
  options: { discardIncompleteUploads?: boolean } = {},
) {
  const source = SQLiteBackend.open(sourcePath)
  const destination = PostgreSQLBackend.open(databaseUrl)
  try {
    await source.initialize()
    await destination.initialize()
    const incompleteUploads = await source.database
      .select({ id: schema.uploadSessions.id })
      .from(schema.uploadSessions)
      .where(isNull(schema.uploadSessions.completedRequestId))
      .all()
    if (incompleteUploads.length && !options.discardIncompleteUploads) {
      throw new Error(
        `${incompleteUploads.length} incomplete upload(s) cannot resume after migration; finish them or rerun with --discard-incomplete-uploads`,
      )
    }
    const unfinishedUploadOperation = await source.database
      .select({ id: schema.operations.id })
      .from(schema.operations)
      .where(and(eq(schema.operations.kind, 'upload'), ne(schema.operations.state, 'committed')))
      .limit(1)
      .get()
    if (unfinishedUploadOperation) {
      throw new Error('an unfinished upload operation still depends on local staging; restart the single instance to recover it first')
    }
    for (const table of tables) {
      if ((await destination.database.select().from(table).limit(1).all()).length) {
        throw new Error(`PostgreSQL target is not empty: ${getTableName(table)}`)
      }
    }

    const counts: Record<string, number> = {}
    await destination.database.transaction(async (transaction) => {
      for (const table of tables) {
        const rows = (await source.database.select().from(table).all()).filter(
          (row) =>
            table !== schema.uploadSessions ||
            !options.discardIncompleteUploads ||
            ('completedRequestId' in row && row.completedRequestId !== null),
        )
        counts[getTableName(table)] = rows.length
        for (let offset = 0; offset < rows.length; offset += 500) {
          await transaction
            .insert(table as Table)
            .values(rows.slice(offset, offset + 500))
            .run()
        }
      }
    })
    return counts
  } finally {
    source.close()
    await destination.close()
  }
}
