// One-shot importer from the Convex-backed PrintHub into the standalone
// SQLite build. Reads an unzipped `npx convex export` directory and writes
// straight into a fresh /data database; files already on the NAS stay put.
//
//   pnpm exec tsx scripts/migrate-convex.ts \
//     --export ./convex-export --data /data --prints /prints \
//     [--operators a@x.com,b@y.com] [--operator a@x.com --operator-password <pw>]
//
// Run it with the app stopped. It refuses a non-empty requests table.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import argon2 from 'argon2'
import Database from 'better-sqlite3'

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

function arg(name: string) {
  const index = process.argv.indexOf(`--${name}`)
  return index > -1 ? process.argv[index + 1] : undefined
}

function fail(message: string): never {
  console.error(`error: ${message}`)
  process.exit(1)
}

function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as T)
}

const exportDir = arg('export') ?? fail('--export <unzipped convex export directory> is required')
const dataDir = arg('data') ?? fail('--data <directory mounted at /data> is required')
const printsDir = arg('prints') ?? fail('--prints <directory mounted at /prints> is required')
const operators = (arg('operators') ?? '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)
const operatorEmail = arg('operator')?.toLowerCase()
const operatorPassword = arg('operator-password')
if (!!operatorEmail !== !!operatorPassword) fail('--operator and --operator-password go together')
if (operatorPassword && operatorPassword.length < 8) fail('--operator-password must be at least 8 characters')

const jobs = readJsonl<ConvexJob>(path.join(exportDir, 'jobs', 'documents.jsonl'))
const users = readJsonl<ConvexUser>(path.join(exportDir, 'users', 'documents.jsonl'))
if (!jobs.length && !users.length) fail(`no jobs or users found under ${exportDir} — is this an unzipped convex export?`)

fs.mkdirSync(dataDir, { recursive: true })
const db = new Database(path.join(dataDir, 'printhub.sqlite'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.pragma('busy_timeout = 2000')
try {
  db.exec('BEGIN IMMEDIATE; COMMIT')
} catch {
  fail('database is locked — stop the PrintHub app before importing')
}

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

// Record the verified prints location so the instance boots healthy. In
// containers this matches the default /prints mount.
db.prepare('INSERT OR REPLACE INTO settings (key,value_json,updated_at) VALUES (?,?,?)')
  .run('storage', JSON.stringify({ adapter: 'local', root: path.resolve(printsDir) }), now)

const insertUser = db.prepare('INSERT OR IGNORE INTO users (id,email,name,password_hash,role,color,created_at) VALUES (?,?,?,?,?,?,?)')
for (const user of users) {
  const email = user.email.toLowerCase()
  insertUser.run(crypto.randomUUID(), email, user.name, null, operators.includes(email) ? 'operator' : 'requester', user.color ?? null, now)
}
if (operatorEmail && operatorPassword) {
  const hash = await argon2.hash(operatorPassword)
  const existing = db.prepare('SELECT id FROM users WHERE email=?').get(operatorEmail) as { id: string } | undefined
  if (existing) {
    db.prepare("UPDATE users SET password_hash=?, role='operator' WHERE id=?").run(hash, existing.id)
  } else {
    db.prepare("INSERT INTO users (id,email,name,password_hash,role,created_at) VALUES (?,?,?,?, 'operator', ?)")
      .run(crypto.randomUUID(), operatorEmail, operatorEmail.split('@')[0], hash, now)
  }
}

const insertRequest = db.prepare(`INSERT INTO requests
  (id,name,file_name,file_path,quantity,requester_email,requester_name,notes,source_url,thumbnail,preview_path,created_at,updated_at)
  VALUES (?,?,?,?,?,?,?,?,NULL,?,?,?,?)`)
const insertStatus = db.prepare('INSERT INTO request_statuses (request_id,status_id,quantity,sort_order) VALUES (?,?,?,?)')

let imported = 0
for (const job of jobs) {
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
      fs.mkdirSync(path.dirname(newPreview), { recursive: true })
      fs.renameSync(oldPreview, newPreview)
      previewPath = newRelative
    } else {
      warnings.push(`preview missing on disk for "${job.name}" (${job.previewPath}) — viewer will load the full file`)
    }
  }
  if (!fs.existsSync(path.join(printsDir, job.filePath))) {
    warnings.push(`file missing on disk for "${job.name}" (${job.filePath}) — downloads will fail until it is restored`)
  }
  const createdAt = job.createdAt ?? Math.round(job._creationTime)
  const requesterName = job.requesterName ?? users.find((user) => user.email.toLowerCase() === job.requesterEmail.toLowerCase())?.name
  insertRequest.run(
    id, job.name, job.fileName, job.filePath, job.quantity, job.requesterEmail.toLowerCase(),
    requesterName ?? null, job.notes ?? null, job.thumbnail ?? null, previewPath,
    createdAt, job.updatedAt ?? createdAt,
  )
  for (const status of ['todo', 'in_progress', 'done']) {
    insertStatus.run(id, status, job.counts[status] ?? 0, job.orders?.[status] ?? null)
  }
  imported++
}

db.close()
console.log(`imported ${imported} request(s) and ${users.length} user(s)`)
if (operatorEmail) console.log(`operator login enabled for ${operatorEmail}`)
for (const warning of warnings) console.warn(`warning: ${warning}`)
console.log('done — start PrintHub and verify the board')
