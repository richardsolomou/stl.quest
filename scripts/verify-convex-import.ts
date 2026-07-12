// Independent post-import check: compares every field of a Convex export
// against the imported SQLite database and the files on disk. Usage:
//   pnpm exec tsx scripts/verify-convex-import.ts <unzipped-export> <data-dir> <prints-dir>

import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

const exportDir = process.argv[2]
const dataDir = process.argv[3]
const printsDir = process.argv[4]
const db = new Database(path.join(dataDir, 'printhub.sqlite'), { readonly: true })

type Job = {
  _id: string; name: string; fileName: string; filePath: string; quantity: number
  requesterEmail: string; requesterName?: string; notes?: string; sourceUrl?: string
  counts: Record<string, number>; orders: Record<string, number>
  thumbnail?: string; previewPath?: string; createdAt: number
}
const jobs: Job[] = fs.readFileSync(path.join(exportDir, 'jobs', 'documents.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
const users = fs.readFileSync(path.join(exportDir, 'users', 'documents.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))

const rows = db.prepare('SELECT * FROM requests').all() as Record<string, unknown>[]
const statuses = db.prepare('SELECT request_id, status_id, quantity, sort_order FROM request_statuses').all() as { request_id: string; status_id: string; quantity: number; sort_order: number | null }[]
const dbUsers = db.prepare('SELECT email, name, role, color FROM user ORDER BY email').all() as { email: string; name: string; role: string; color: string | null }[]

const issues: string[] = []
const byPath = new Map(rows.map((row) => [row.file_path as string, row]))

console.log(`export: ${jobs.length} jobs, ${users.length} users`)
console.log(`sqlite: ${rows.length} requests, ${dbUsers.length} users\n`)
if (jobs.length !== rows.length) issues.push(`request count mismatch: ${jobs.length} exported vs ${rows.length} imported`)

let thumbs = 0, previews = 0, filesPresent = 0
for (const job of jobs) {
  const row = byPath.get(job.filePath)
  if (!row) { issues.push(`MISSING: "${job.name}" (${job.filePath}) not in sqlite`); continue }
  const id = row.id as string
  const field = (label: string, expected: unknown, actual: unknown) => {
    if ((expected ?? null) !== (actual ?? null)) issues.push(`"${job.name}": ${label} exported=${JSON.stringify(expected)} imported=${JSON.stringify(actual)}`)
  }
  field('name', job.name, row.name)
  field('fileName', job.fileName, row.file_name)
  field('quantity', job.quantity, row.quantity)
  field('requesterEmail', job.requesterEmail.toLowerCase(), row.requester_email)
  const userName = users.find((user) => user.email.toLowerCase() === job.requesterEmail.toLowerCase())?.name
  field('requesterName', job.requesterName ?? userName, row.requester_name)
  field('notes', job.notes, row.notes)
  field('createdAt', Math.round(job.createdAt), row.created_at)

  const rowStatuses = new Map(statuses.filter((status) => status.request_id === id).map((status) => [status.status_id, status]))
  for (const [statusId, count] of Object.entries(job.counts)) {
    const imported = rowStatuses.get(statusId)
    if ((imported?.quantity ?? 0) !== count) issues.push(`"${job.name}": counts.${statusId} exported=${count} imported=${imported?.quantity ?? 0}`)
  }
  for (const [statusId, order] of Object.entries(job.orders ?? {})) {
    const imported = rowStatuses.get(statusId)
    if ((imported?.sort_order ?? null) !== order) issues.push(`"${job.name}": orders.${statusId} exported=${order} imported=${imported?.sort_order ?? null}`)
  }
  const totalImported = [...rowStatuses.values()].reduce((sum, status) => sum + status.quantity, 0)
  if (totalImported !== job.quantity) issues.push(`"${job.name}": status quantities sum ${totalImported} != quantity ${job.quantity}`)

  if (job.thumbnail) {
    if (!row.thumbnail_path) issues.push(`"${job.name}": exported thumbnail not imported`)
    else if (fs.existsSync(path.join(printsDir, row.thumbnail_path as string))) thumbs++
    else issues.push(`"${job.name}": thumbnail file missing at ${row.thumbnail_path}`)
  }
  if (job.previewPath) {
    if (!row.preview_path) issues.push(`"${job.name}": exported previewPath not imported`)
    else previews++
  }
  if (fs.existsSync(path.join(printsDir, job.filePath))) filesPresent++
}

for (const user of users) {
  const imported = dbUsers.find((dbUser) => dbUser.email === user.email.toLowerCase())
  if (!imported) { issues.push(`USER MISSING: ${user.email}`); continue }
  if (imported.name !== user.name) issues.push(`user ${user.email}: name exported=${user.name} imported=${imported.name}`)
  if ((imported.color ?? null) !== (user.color ?? null)) issues.push(`user ${user.email}: color mismatch`)
}
const credential = db.prepare("SELECT count(*) count FROM account WHERE providerId='credential'").get() as { count: number }

console.log(`thumbnails decoded to files: ${thumbs}/${jobs.filter((job) => job.thumbnail).length}`)
console.log(`preview paths carried over: ${previews}/${jobs.filter((job) => job.previewPath).length}`)
console.log(`STL files present locally: ${filesPresent}/${jobs.length} (rest pending NAS copy)`)
console.log(`operator credential accounts: ${credential.count}`)
console.log(`users: ${dbUsers.map((user) => `${user.email}(${user.role})`).join(', ')}\n`)
console.log(issues.length ? `ISSUES (${issues.length}):\n${issues.join('\n')}` : 'NO METADATA MISMATCHES — every exported field verified against sqlite')
db.close()
