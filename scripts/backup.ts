import fs from 'node:fs'
import path from 'node:path'
import { Command } from 'commander'
import { backupDatabase } from '../src/db/backup'
import { closeDatabase, openDatabase } from '../src/db'

const options = new Command()
  .name('backup')
  .description('Create a consistent online backup of the PrintHub SQLite database.')
  .option('--output <file>', 'backup file path', `printhub-backup-${new Date().toISOString().replaceAll(':', '-')}.sqlite`)
  .parse()
  .opts<{ output: string }>()

const destination = path.resolve(options.output)
const dataDirectory = path.resolve(process.env.DATA_DIR ?? '/data')
const source = path.join(dataDirectory, 'printhub.sqlite')
const integrationKey = path.join(dataDirectory, 'integration-secrets.key')
if (destination === source) throw new Error('backup output must differ from the live database')
if (!fs.existsSync(source)) throw new Error(`database does not exist: ${source}`)
fs.mkdirSync(path.dirname(destination), { recursive: true })
const database = openDatabase(source, { readonly: true, fileMustExist: true })
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
