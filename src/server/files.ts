import fs from 'node:fs'
import path from 'node:path'
import { STATUS_FOLDERS, STATUSES, type Status } from '../../convex/statuses'

export function printsDir(): string {
  const dir = process.env.PRINTS_DIR
  if (!dir) throw new Error('PRINTS_DIR is not set')
  return path.resolve(dir)
}

export async function ensureStatusFolders(): Promise<void> {
  await Promise.all(
    STATUSES.map((status) => fs.promises.mkdir(path.join(printsDir(), STATUS_FOLDERS[status]), { recursive: true })),
  )
}

/** Resolve a doc's relative filePath, refusing anything that escapes PRINTS_DIR. */
export function absolutePath(relativePath: string): string {
  const root = printsDir()
  const resolved = path.resolve(root, relativePath)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Response('invalid path', { status: 400 })
  }
  return resolved
}

export function sanitizeBaseName(fileName: string): string {
  return path
    .basename(fileName)
    .replace(/\.stl$/i, '')
    .replace(/[^\w.\- ]+/g, '_')
    .trim()
    .slice(0, 120)
}

export function newRelativePath(originalFileName: string): string {
  const base = sanitizeBaseName(originalFileName) || 'model'
  const id = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`
  return path.join(STATUS_FOLDERS.todo, `${id}__${base}.stl`)
}

/** Move a job's file into the folder for `status`; returns the new relative path. */
export async function moveToStatusFolder(relativePath: string, status: Status): Promise<string> {
  const from = absolutePath(relativePath)
  const nextRelative = path.join(STATUS_FOLDERS[status], path.basename(relativePath))
  const to = absolutePath(nextRelative)
  if (from === to) return nextRelative
  await fs.promises.mkdir(path.dirname(to), { recursive: true })
  await fs.promises.rename(from, to)
  return nextRelative
}
