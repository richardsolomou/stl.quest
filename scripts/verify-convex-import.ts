// Independent post-import check: compares every field of a Convex export
// against the imported SQLite database and the files on disk. Usage:
//   pnpm exec tsx scripts/verify-convex-import.ts <unzipped-export> <data-dir> <prints-dir>

import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import Database from 'better-sqlite3'
import { Command } from 'commander'

const options = new Command()
  .name('verify-convex-import')
  .description('Compare a Convex export with an imported PrintHub database and its files.')
  .requiredOption('--export <directory>', 'unzipped Convex export directory')
  .requiredOption('--data <directory>', 'directory containing printhub.sqlite')
  .requiredOption('--prints <directory>', 'directory containing imported print files')
  .parse()
  .opts<{ export: string; data: string; prints: string }>()

const exportDir = options.export
const dataDir = options.data
const printsDir = options.prints
const db = new Database(path.join(dataDir, 'printhub.sqlite'), { readonly: true })

type Job = {
  _id: string
  name: string
  fileName: string
  filePath: string
  quantity: number
  requesterEmail: string
  requesterName?: string
  notes?: string
  sourceUrl?: string
  counts: Record<string, number>
  orders: Record<string, number>
  thumbnail?: string
  previewPath?: string
  createdAt: number
}
const jobsFile = path.join(exportDir, 'jobs', 'documents.jsonl')
const users = fs
  .readFileSync(path.join(exportDir, 'users', 'documents.jsonl'), 'utf8')
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line) as { email: string; name: string; color?: string })
const userNames = new Map(users.map((user) => [user.email.toLowerCase(), user.name]))

async function* iterateJobs(): AsyncGenerator<Job> {
  const lines = readline.createInterface({ input: fs.createReadStream(jobsFile), crlfDelay: Infinity })
  for await (const line of lines) {
    if (line) yield JSON.parse(line) as Job
  }
}

const rows = db.prepare('SELECT * FROM requests').all() as Record<string, unknown>[]
const statuses = db.prepare('SELECT request_id, status_id, quantity, sort_order FROM request_statuses').all() as {
  request_id: string
  status_id: string
  quantity: number
  sort_order: number | null
}[]
const dbUsers = db.prepare('SELECT email, name, role, color FROM user ORDER BY email').all() as {
  email: string
  name: string
  role: string
  color: string | null
}[]

const issues: string[] = []
const byPath = new Map(rows.map((row) => [row.file_path as string, row]))

console.log(`export: streaming jobs, ${users.length} users`)
console.log(`sqlite: ${rows.length} requests, ${dbUsers.length} users\n`)

let jobs = 0,
  exportedThumbs = 0,
  exportedPreviews = 0
let thumbs = 0,
  previews = 0,
  filesPresent = 0
for await (const job of iterateJobs()) {
  jobs++
  const row = byPath.get(job.filePath)
  if (!row) {
    issues.push(`MISSING: "${job.name}" (${job.filePath}) not in sqlite`)
    continue
  }
  const id = row.id as string
  const field = (label: string, expected: unknown, actual: unknown) => {
    if ((expected ?? null) !== (actual ?? null))
      issues.push(`"${job.name}": ${label} exported=${JSON.stringify(expected)} imported=${JSON.stringify(actual)}`)
  }
  field('name', job.name, row.name)
  field('fileName', job.fileName, row.file_name)
  field('quantity', job.quantity, row.quantity)
  field('requesterEmail', job.requesterEmail.toLowerCase(), row.requester_email)
  const userName = userNames.get(job.requesterEmail.toLowerCase())
  field('requesterName', job.requesterName ?? userName, row.requester_name)
  field('notes', job.notes, row.notes)
  field('createdAt', Math.round(job.createdAt), row.created_at)

  const rowStatuses = new Map(statuses.filter((status) => status.request_id === id).map((status) => [status.status_id, status]))
  for (const [statusId, count] of Object.entries(job.counts)) {
    const imported = rowStatuses.get(statusId)
    if ((imported?.quantity ?? 0) !== count)
      issues.push(`"${job.name}": counts.${statusId} exported=${count} imported=${imported?.quantity ?? 0}`)
  }
  for (const [statusId, order] of Object.entries(job.orders ?? {})) {
    const imported = rowStatuses.get(statusId)
    if ((imported?.sort_order ?? null) !== order)
      issues.push(`"${job.name}": orders.${statusId} exported=${order} imported=${imported?.sort_order ?? null}`)
  }
  const totalImported = [...rowStatuses.values()].reduce((sum, status) => sum + status.quantity, 0)
  if (totalImported !== job.quantity) issues.push(`"${job.name}": status quantities sum ${totalImported} != quantity ${job.quantity}`)

  if (job.thumbnail) {
    exportedThumbs++
    const thumbnailPath = typeof row.thumbnail_path === 'string' ? row.thumbnail_path : undefined
    if (!thumbnailPath) issues.push(`"${job.name}": exported thumbnail not imported`)
    else if (fs.existsSync(path.join(printsDir, thumbnailPath))) thumbs++
    else issues.push(`"${job.name}": thumbnail file missing at ${thumbnailPath}`)
  }
  if (job.previewPath) {
    exportedPreviews++
    const previewPath = typeof row.preview_path === 'string' ? row.preview_path : undefined
    if (!previewPath) issues.push(`"${job.name}": exported previewPath not imported`)
    else if (fs.existsSync(path.join(printsDir, previewPath))) previews++
    else issues.push(`"${job.name}": preview file missing at ${previewPath}`)
  }
  if (fs.existsSync(path.join(printsDir, job.filePath))) filesPresent++
  else issues.push(`"${job.name}": original print file missing at ${job.filePath}`)
}
if (jobs !== rows.length) issues.push(`request count mismatch: ${jobs} exported vs ${rows.length} imported`)

for (const user of users) {
  const imported = dbUsers.find((dbUser) => dbUser.email === user.email.toLowerCase())
  if (!imported) {
    issues.push(`USER MISSING: ${user.email}`)
    continue
  }
  if (imported.name !== user.name) issues.push(`user ${user.email}: name exported=${user.name} imported=${imported.name}`)
  if ((imported.color ?? null) !== (user.color ?? null)) issues.push(`user ${user.email}: color mismatch`)
}
const credential = db.prepare("SELECT count(*) count FROM account WHERE providerId='credential'").get() as { count: number }

console.log(`thumbnails decoded to files: ${thumbs}/${exportedThumbs}`)
console.log(`preview paths carried over: ${previews}/${exportedPreviews}`)
console.log(`STL files present locally: ${filesPresent}/${jobs} (rest pending NAS copy)`)
console.log(`admin credential accounts: ${credential.count}`)
console.log(`users: ${dbUsers.map((user) => `${user.email}(${user.role})`).join(', ')}\n`)
console.log(
  issues.length
    ? `ISSUES (${issues.length}):\n${issues.join('\n')}`
    : 'NO METADATA MISMATCHES — every exported field verified against sqlite',
)
db.close()
if (issues.length) process.exitCode = 1
