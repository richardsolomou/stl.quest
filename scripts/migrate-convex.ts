// One-shot importer from the Convex-backed PrintHub into the standalone
// SQLite build. Reads an unzipped `npx convex export` directory and writes
// straight into a fresh /data database; files already on the NAS stay put.
//
//   pnpm exec tsx scripts/migrate-convex.ts \
//     --export ./convex-export --data /data --prints /prints \
//     [--admins a@x.com,b@y.com] [--admin a@x.com --admin-password <pw>] [--dry-run]
//
// Run it with the app stopped. It refuses a non-empty requests table.
// --dry-run exercises the full import against an in-memory database and
// touches nothing on disk — safe to run against a live deployment.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline'
import argon2 from 'argon2'
import Database from 'better-sqlite3'
import { Command } from 'commander'

type ConvexJob = {
  _id: string
  _creationTime: number
  name: string
  fileName: string
  filePath: string
  quantity: number
  requesterEmail: string
  requesterName?: string
  counts: Record<string, number>
  orders?: Record<string, number | undefined>
  notes?: string
  thumbnail?: string
  previewPath?: string
  createdAt?: number
  updatedAt?: number
}

type ConvexUser = { _id: string; email: string; name: string; color?: string }

type MigrationOptions = {
  export: string
  data?: string
  prints: string
  admins?: string
  admin?: string
  adminPassword?: string
  dryRun: boolean
}

function fail(message: string): never {
  console.error(`error: ${message}`)
  process.exit(1)
}

function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return []
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}

// Jobs can carry ~300KB inline thumbnails; parse one line at a time instead
// of materializing every parsed document.
async function* iterateJsonl<T>(file: string): AsyncGenerator<T> {
  if (!fs.existsSync(file)) return
  const lines = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })
  for await (const line of lines) {
    if (line) yield JSON.parse(line) as T
  }
}

const program = new Command()
  .name('migrate-convex')
  .description('Import an unzipped Convex export into a standalone PrintHub SQLite database.')
  .requiredOption('--export <directory>', 'unzipped Convex export directory')
  .option('--data <directory>', 'directory mounted at /data; required unless --dry-run')
  .requiredOption('--prints <directory>', 'directory mounted at /prints')
  .option('--admins <emails>', 'comma-separated emails to promote to admins')
  .option('--admin <email>', 'create an admin account')
  .option('--admin-password <password>', 'password for the created admin account')
  .option('--dry-run', 'run the full import against an in-memory database', false)
  .parse()

const options = program.opts<MigrationOptions>()
const dryRun = options.dryRun
const exportDir = options.export
const dataDir = dryRun ? undefined : (options.data ?? fail('--data <directory mounted at /data> is required unless --dry-run is used'))
const printsDir = options.prints
const admins = new Set(
  (options.admins ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
)
const adminEmail = options.admin?.toLowerCase()
const adminPassword = options.adminPassword
if (!!adminEmail !== !!adminPassword) fail('--admin and --admin-password go together')
if (adminPassword && adminPassword.length < 12) fail('--admin-password must be at least 12 characters')

const jobsFile = path.join(exportDir, 'jobs', 'documents.jsonl')
const users = readJsonl<ConvexUser>(path.join(exportDir, 'users', 'documents.jsonl'))
if (!fs.existsSync(jobsFile) && !users.length) fail(`no jobs or users found under ${exportDir} — is this an unzipped convex export?`)
const userNames = new Map(users.map((user) => [user.email.toLowerCase(), user.name]))

const missingFiles: string[] = []
for await (const job of iterateJsonl<ConvexJob>(jobsFile)) {
  if (!fs.existsSync(path.join(printsDir, job.filePath))) missingFiles.push(`"${job.name}" (${job.filePath})`)
}
if (missingFiles.length) {
  fail(`missing ${missingFiles.length} referenced print file(s):\n${missingFiles.map((file) => `- ${file}`).join('\n')}`)
}

const started = performance.now()
let db: InstanceType<typeof Database>
if (dryRun) {
  db = new Database(':memory:')
} else {
  fs.mkdirSync(dataDir!, { recursive: true })
  db = new Database(path.join(dataDir!, 'printhub.sqlite'))
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 2000')
  try {
    db.exec('BEGIN IMMEDIATE; COMMIT')
  } catch {
    fail('database is locked — stop the PrintHub app before importing')
  }
}
db.pragma('foreign_keys = ON')

// Same numbered migrations the app applies on boot.
const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'adapters', 'migrations')
db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)')
const applied = new Set((db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((row) => row.version))
for (const file of fs.readdirSync(migrationsDir).sort()) {
  const version = Number(file.split('_')[0])
  if (applied.has(version)) continue
  db.transaction(() => {
    db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
    db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(version, Date.now())
  })()
}

if ((db.prepare('SELECT count(*) count FROM requests').get() as { count: number }).count > 0) {
  fail('this database already contains requests — import only into a fresh /data')
}

const warnings: string[] = []
const now = Date.now()
const iso = new Date(now).toISOString()
const adminHash = adminPassword ? await argon2.hash(adminPassword) : undefined

// better-auth owns these tables; dates are stored as ISO strings.
const insertUser = db.prepare(
  'INSERT OR IGNORE INTO "user" (id,name,email,emailVerified,createdAt,updatedAt,role,color) VALUES (?,?,?,0,?,?,?,?)',
)
const insertCredential = db.prepare(
  "INSERT INTO account (id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES (?,?,'credential',?,?,?,?)",
)
const insertRequest = db.prepare(`INSERT INTO requests
  (id,name,file_name,file_path,quantity,requester_email,requester_name,notes,source_url,thumbnail_path,preview_path,created_at,updated_at)
  VALUES (?,?,?,?,?,?,?,?,NULL,?,?,?,?)`)
const insertStatus = db.prepare('INSERT INTO request_statuses (request_id,status_id,quantity,sort_order) VALUES (?,?,?,?)')

let imported = 0
// Keep the database transaction open while jobs are streamed one line at a
// time. This preserves all-or-nothing database writes without retaining large
// inline thumbnails in memory. Preview files already moved before a failure
// are re-adopted by the existing-target branch on retry.
db.exec('BEGIN IMMEDIATE')
try {
  // Record the verified prints location so the instance boots healthy. In
  // containers this matches the default /prints mount.
  db.prepare('INSERT OR REPLACE INTO settings (key,value_json,updated_at) VALUES (?,?,?)').run(
    'storage',
    JSON.stringify({ adapter: 'local', root: path.resolve(printsDir) }),
    now,
  )

  for (const user of users) {
    const email = user.email.toLowerCase()
    insertUser.run(crypto.randomUUID(), user.name, email, iso, iso, admins.has(email) ? 'admin' : 'requester', user.color ?? null)
  }
  if (adminEmail && adminHash) {
    let adminId = (db.prepare('SELECT id FROM "user" WHERE email=?').get(adminEmail) as { id: string } | undefined)?.id
    if (adminId) {
      db.prepare('UPDATE "user" SET role=\'admin\' WHERE id=?').run(adminId)
    } else {
      adminId = crypto.randomUUID()
      insertUser.run(adminId, adminEmail.split('@')[0], adminEmail, iso, iso, 'admin', null)
    }
    db.prepare("DELETE FROM account WHERE userId=? AND providerId='credential'").run(adminId)
    insertCredential.run(crypto.randomUUID(), adminId, adminId, adminHash, iso, iso)
  }

  for await (const job of iterateJsonl<ConvexJob>(jobsFile)) {
    const id = crypto.randomUUID()
    let previewPath: string | null = null
    if (job.previewPath) {
      const basename = path.basename(job.previewPath)
      const oldPreview = path.join(printsDir, job.previewPath)
      const newRelative = path.join('.printhub', 'previews', basename)
      const newPreview = path.join(printsDir, newRelative)
      if (fs.existsSync(newPreview)) {
        previewPath = newRelative
      } else if (fs.existsSync(oldPreview)) {
        if (!dryRun) {
          fs.mkdirSync(path.dirname(newPreview), { recursive: true })
          fs.renameSync(oldPreview, newPreview)
        }
        previewPath = newRelative
      } else {
        warnings.push(`preview missing on disk for "${job.name}" (${job.previewPath}) — viewer will load the full file`)
      }
    }
    // Convex stored thumbnails inline as base64; the new app keeps them as
    // files in storage under .printhub/thumbnails/.
    let thumbnailPath: string | null = null
    const thumbnailMatch = job.thumbnail ? /^data:image\/(png|webp|jpeg);base64,(.+)$/.exec(job.thumbnail) : null
    if (thumbnailMatch) {
      const extension = thumbnailMatch[1] === 'jpeg' ? 'jpg' : thumbnailMatch[1]
      thumbnailPath = path.join('.printhub', 'thumbnails', `${path.basename(job.filePath).replace(/\.stl$/i, '')}.${extension}`)
      if (!dryRun) {
        const target = path.join(printsDir, thumbnailPath)
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target, Buffer.from(thumbnailMatch[2], 'base64'))
      }
    } else if (job.thumbnail) {
      warnings.push(`unrecognized thumbnail format for "${job.name}" — skipped`)
    }
    const createdAt = job.createdAt ?? Math.round(job._creationTime)
    const requesterName = job.requesterName ?? userNames.get(job.requesterEmail.toLowerCase())
    insertRequest.run(
      id,
      job.name,
      job.fileName,
      job.filePath,
      job.quantity,
      job.requesterEmail.toLowerCase(),
      requesterName ?? null,
      job.notes ?? null,
      thumbnailPath,
      previewPath,
      createdAt,
      job.updatedAt ?? createdAt,
    )
    for (const status of ['todo', 'in_progress', 'done']) {
      insertStatus.run(id, status, job.counts[status] ?? 0, job.orders?.[status] ?? null)
    }
    imported++
  }
  db.exec('COMMIT')
} catch (error) {
  db.exec('ROLLBACK')
  throw error
}

db.close()
const seconds = ((performance.now() - started) / 1000).toFixed(1)
console.log(`${dryRun ? '[dry run] would import' : 'imported'} ${imported} request(s) and ${users.length} user(s) in ${seconds}s`)
if (adminEmail) console.log(`${dryRun ? '[dry run] would enable' : 'enabled'} admin login for ${adminEmail}`)
for (const warning of warnings) console.warn(`warning: ${warning}`)
console.log(dryRun ? '[dry run] no files or databases were modified' : 'done — start PrintHub and verify the board')
