import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { UploadStagingArea } from '../core/types'

// Chunked uploads always stage on local disk under /data: resumable appends
// need random access, which final storage adapters cannot promise.
export class UploadStaging implements UploadStagingArea {
  readonly root: string

  constructor(dataRoot = process.env.DATA_DIR ?? '/data') {
    this.root = path.join(path.resolve(dataRoot), 'uploads')
  }

  async initialize() {
    await fs.promises.mkdir(this.root, { recursive: true })
  }

  uploadPart(uploadId: string) {
    return path.join(this.root, `${validUploadId(uploadId)}.part`)
  }

  uploadPreviewPart(uploadId: string) {
    return path.join(this.root, `${validUploadId(uploadId)}.preview.part`)
  }

  uploadThumbnailPart(uploadId: string) {
    return path.join(this.root, `${validUploadId(uploadId)}.thumb.part`)
  }

  async writeUploadPart(filePath: string, bytes: Uint8Array) {
    const directory = path.dirname(filePath)
    await fs.promises.mkdir(directory, { recursive: true })
    const handle = await fs.promises.open(filePath, 'w')
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await syncDirectory(directory)
  }

  async size(filePath: string) {
    return fs.promises.stat(filePath).then((stat) => stat.size).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return 0
      throw error
    })
  }

  async remove(filePath: string) {
    await fs.promises.rm(filePath, { force: true })
  }

  async sweepUploads(exclude: ReadonlySet<string> = new Set()) {
    await fs.promises.mkdir(this.root, { recursive: true })
    for (const name of await fs.promises.readdir(this.root)) {
      const match = /^([a-z0-9-]{10,64})(?:\.(?:preview|thumb))?\.part$/i.exec(name)
      if (!match) continue
      if (exclude.has(match[1])) continue
      const file = path.join(this.root, name)
      const stat = await fs.promises.stat(file).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined
        throw error
      })
      if (stat && Date.now() - stat.mtimeMs > 86_400_000) await fs.promises.rm(file, { force: true })
    }
  }

  async writable() {
    const probe = path.join(this.root, `.printhub-health-${crypto.randomUUID()}`)
    await fs.promises.writeFile(probe, '')
    await fs.promises.rm(probe, { force: true })
  }
}

function validUploadId(uploadId: string) {
  if (!/^[a-z0-9-]{10,64}$/i.test(uploadId)) throw new Response('invalid upload id', { status: 400 })
  return uploadId
}

async function syncDirectory(directory: string) {
  const handle = await fs.promises.open(directory, 'r')
  try { await handle.sync() } finally { await handle.close() }
}
