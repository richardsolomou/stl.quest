import fs from 'node:fs'
import path from 'node:path'
import { Command } from 'commander'
import { backupDatabase } from '../src/db/backup'
import { closeDatabase, databasePath, openDatabase } from '../src/db'

const options = new Command()
  .name('backup')
  .description('Create a consistent online backup of the STL Quest SQLite database.')
  .option('--output <file>', 'backup file path', `stlquest-backup-${new Date().toISOString().replaceAll(':', '-')}.sqlite`)
  .parse()
  .opts<{ output: string }>()

if (process.env.DATABASE_URL) throw new Error('the backup command supports local SQLite only; use the PostgreSQL provider backup')
const destination = path.resolve(options.output)
const dataDirectory = path.resolve(process.env.DATA_DIR ?? '/data')
const source = databasePath()
const integrationKey = path.join(dataDirectory, 'integration-secrets.key')
if (destination === source) throw new Error('backup output must differ from the live database')
if (!fs.existsSync(source)) throw new Error(`database does not exist: ${source}`)
fs.mkdirSync(path.dirname(destination), { recursive: true })
const database = openDatabase(source)
try {
  const result = await backupDatabase(database, destination)
  console.log(`backup written to ${destination} (${result.totalPages} pages)`)
  if (fs.existsSync(integrationKey)) {
    const keyDestination = `${destination}.integration-secrets.key`
    fs.copyFileSync(integrationKey, keyDestination, fs.constants.COPYFILE_EXCL)
    fs.chmodSync(keyDestination, 0o600)
    console.log(`integration key written to ${keyDestination}`)
  } else if (process.env.INTEGRATIONS_ENCRYPTION_KEY) {
    console.log('integration settings use INTEGRATIONS_ENCRYPTION_KEY; back up that deployment secret separately')
  }
} finally {
  closeDatabase(database)
}
