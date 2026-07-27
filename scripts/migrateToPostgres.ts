import fs from 'node:fs'
import path from 'node:path'
import { Command } from 'commander'
import { databasePath } from '../src/db'
import { migrateSQLiteToPostgreSQL } from '../src/db/migrateToPostgres'

const options = new Command()
  .name('migrate-to-postgres')
  .description('Copy an offline STL Quest SQLite database into an empty PostgreSQL database.')
  .requiredOption('--database-url <url>', 'empty PostgreSQL database URL')
  .option('--sqlite <file>', 'SQLite database path', databasePath())
  .option('--discard-incomplete-uploads', 'discard local resumable uploads that cannot continue in distributed mode')
  .parse()
  .opts<{ databaseUrl: string; sqlite: string; discardIncompleteUploads?: boolean }>()

const source = path.resolve(options.sqlite)
if (!fs.existsSync(source)) throw new Error(`database does not exist: ${source}`)
if (!/^postgres(?:ql)?:\/\//i.test(options.databaseUrl)) throw new Error('--database-url must use postgres:// or postgresql://')

const counts = await migrateSQLiteToPostgreSQL(source, options.databaseUrl, {
  discardIncompleteUploads: options.discardIncompleteUploads,
})
const rows = Object.values(counts).reduce((total, count) => total + count, 0)
console.log(`migrated ${rows} rows across ${Object.keys(counts).length} tables`)
