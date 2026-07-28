import fs from 'node:fs'
import path from 'node:path'

export async function filesystemCapacity(target: string) {
  const stats = await fs.promises.statfs(target, { bigint: true })
  return { totalBytes: Number(stats.blocks * stats.bsize), freeBytes: Number(stats.bavail * stats.bsize) }
}

export async function assertUploadCapacity(stagingPath: string, bytes: number) {
  const { freeBytes } = await filesystemCapacity(path.dirname(stagingPath))
  const reserve = Math.max(256 * 1024 * 1024, Math.ceil(bytes * 0.05))
  if (freeBytes < bytes + reserve) throw new Response('not enough free disk space for this upload', { status: 507 })
}
