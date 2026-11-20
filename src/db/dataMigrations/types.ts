import type { STLQuestDatabase } from '../connection'

export type MigrationTransaction = Parameters<Parameters<STLQuestDatabase['transaction']>[0]>[0]

type LogMethod = (fields: { event: string } & Record<string, unknown>, message: string) => void
/** Where migrations report progress, and what an operator may want to know, such as references they had to clear. */
export type MigrationLog = { info: LogMethod; warn: LogMethod }

/**
 * A one-way change to stored data, run once per deployment in registry order. It runs straight after the schema
 * migration named `after` (its tag without the number, the same in both dialects) and before any later one, so it sees
 * the schema exactly as it was written against; it therefore declares the tables it touches itself rather than
 * importing the live schema, which keeps changing after it is released.
 */
export type DataMigration = {
  id: string
  after: string
  run(database: MigrationTransaction, log: MigrationLog): Promise<void>
}

export interface SchemaMigrator {
  /** Applies pending schema migrations up to the one named `through`, or all of them. */
  migrateSchema(through?: string): Promise<void>
}
