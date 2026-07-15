import fs from 'node:fs'
import path from 'node:path'

export async function storageDirectories(directory: string) {
  if (!(await fs.promises.stat(directory)).isDirectory()) throw Object.assign(new Error('path is not a folder'), { code: 'ENOTDIR' })
  const entries = await fs.promises.readdir(directory, { withFileTypes: true })
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(directory, entry.name)
        if (entry.isDirectory()) return { name: entry.name, path: entryPath }
        if (!entry.isSymbolicLink()) return undefined
        const target = await fs.promises.stat(entryPath).catch(() => undefined)
        return target?.isDirectory() ? { name: entry.name, path: entryPath } : undefined
      }),
    )
  )
    .filter((entry): entry is { name: string; path: string } => !!entry)
    .sort((first, second) => first.name.localeCompare(second.name))
}
