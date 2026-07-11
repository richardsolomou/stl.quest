import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { AssetStore } from '../core/types'
import { initialStatus, statusById, workflow } from '../core/workflow'

export class LocalAssetStore implements AssetStore {
  readonly root: string
  readonly dataRoot: string

  constructor(root = process.env.PRINTS_DIR ?? '/prints', dataRoot = process.env.DATA_DIR ?? '/data') {
    this.root = path.resolve(root)
    this.dataRoot = path.resolve(dataRoot)
  }

  async initialize() {
    await Promise.all([
      ...workflow.statuses.map((status) => fs.promises.mkdir(path.join(this.root, status.folder), { recursive: true })),
      fs.promises.mkdir(path.join(this.root, '.printhub', 'previews'), { recursive: true }),
      fs.promises.mkdir(path.join(this.root, '.printhub', 'trash'), { recursive: true }),
      fs.promises.mkdir(path.join(this.dataRoot, 'uploads'), { recursive: true }),
    ])
  }

  absolute(relativePath: string) {
    const resolved = path.resolve(this.root, relativePath)
    if (resolved !== this.root && !resolved.startsWith(this.root + path.sep)) throw new Response('invalid path', { status: 400 })
    return resolved
  }

  createPath(originalFileName: string) {
    const base = path.basename(originalFileName).replace(/\.stl$/i, '').replace(/[^\w.\- ]+/g, '_').trim().slice(0, 120) || 'model'
    return path.join(initialStatus().folder, `${Date.now()}_${crypto.randomUUID().slice(0, 8)}__${base}.stl`)
  }

  previewPath(originalRelativePath: string) {
    return path.join('.printhub', 'previews', path.basename(originalRelativePath))
  }

  async finalizeUpload(partPath: string, relativePath: string) {
    const destination = this.absolute(relativePath)
    await fs.promises.mkdir(path.dirname(destination), { recursive: true })
    const sourceDirectory = path.dirname(partPath)
    const [sourceExists, destinationExists] = await Promise.all([
      fs.promises.stat(partPath).then(() => true).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? false : Promise.reject(error)),
      this.exists(relativePath),
    ])
    if (!sourceExists && destinationExists) return
    if (!sourceExists) throw Object.assign(new Error(`upload part missing: ${partPath}`), { code: 'ENOENT' })
    if (destinationExists) throw new Error(`upload destination already exists: ${relativePath}`)
    try {
      const handle = await fs.promises.open(partPath, 'r')
      try { await handle.sync() } finally { await handle.close() }
      await fs.promises.rename(partPath, destination)
      await this.syncDirectory(path.dirname(destination))
      if (sourceDirectory !== path.dirname(destination)) await this.syncDirectory(sourceDirectory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
      const temporary = `${destination}.${crypto.randomUUID()}.tmp`
      try {
        await fs.promises.copyFile(partPath, temporary, fs.constants.COPYFILE_EXCL)
        const handle = await fs.promises.open(temporary, 'r')
        try { await handle.sync() } finally { await handle.close() }
        await fs.promises.rename(temporary, destination)
        await this.syncDirectory(path.dirname(destination))
        await fs.promises.unlink(partPath)
        await this.syncDirectory(sourceDirectory)
      } catch (copyError) {
        await fs.promises.rm(temporary, { force: true }).catch(() => undefined)
        throw copyError
      }
    }
  }

  async write(relativePath: string, bytes: Uint8Array) {
    const destination = this.absolute(relativePath)
    await fs.promises.mkdir(path.dirname(destination), { recursive: true })
    await this.writeUploadPart(destination, bytes)
    await this.syncDirectory(path.dirname(destination))
  }

  async move(relativePath: string, statusId: string) {
    const next = this.destinationPath(relativePath, statusId)
    await this.ensureMoved(relativePath, next)
    return next
  }

  destinationPath(relativePath: string, statusId: string) {
    return path.join(statusById(statusId).folder, path.basename(relativePath))
  }

  async ensureMoved(sourcePath: string, destinationPath: string) {
    const from = this.absolute(sourcePath)
    const to = this.absolute(destinationPath)
    if (from === to) return
    await fs.promises.mkdir(path.dirname(to), { recursive: true })
    const [sourceExists, destinationExists] = await Promise.all([this.exists(sourcePath), this.exists(destinationPath)])
    if (!sourceExists && destinationExists) return
    if (!sourceExists) throw Object.assign(new Error(`asset missing: ${sourcePath}`), { code: 'ENOENT' })
    if (destinationExists) throw new Error(`asset destination already exists: ${destinationPath}`)
    await fs.promises.rename(from, to)
    await this.syncDirectory(path.dirname(to))
    if (path.dirname(from) !== path.dirname(to)) await this.syncDirectory(path.dirname(from))
  }

  async exists(relativePath: string) {
    return fs.promises.stat(this.absolute(relativePath)).then(() => true).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return false
      throw error
    })
  }

  async remove(relativePath: string) { await fs.promises.rm(this.absolute(relativePath), { force: true }) }

  async trash(relativePath: string) {
    const source = this.absolute(relativePath)
    const trashPath = path.join('.printhub', 'trash', `${crypto.randomUUID()}__${path.basename(relativePath)}`)
    try {
      await fs.promises.rename(source, this.absolute(trashPath))
      return trashPath
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  trashPath(operationId: string, relativePath: string) {
    if (!/^[a-f0-9-]{36}$/i.test(operationId)) throw new Error('invalid operation id')
    const assetId = crypto.createHash('sha256').update(relativePath).digest('hex').slice(0, 16)
    return path.join('.printhub', 'trash', `${operationId}__${assetId}__${path.basename(relativePath)}`)
  }

  async purgeTrash(trashPath: string) { await this.remove(trashPath) }

  async sweepTrash() {
    const directory = this.absolute(path.join('.printhub', 'trash'))
    await fs.promises.mkdir(directory, { recursive: true })
    for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
      if (entry.isFile()) await fs.promises.rm(path.join(directory, entry.name), { force: true })
    }
  }

  uploadPart(uploadId: string) {
    if (!/^[a-z0-9-]{10,64}$/i.test(uploadId)) throw new Response('invalid upload id', { status: 400 })
    return path.join(this.dataRoot, 'uploads', `${uploadId}.part`)
  }

  uploadPreviewPart(uploadId: string) {
    if (!/^[a-z0-9-]{10,64}$/i.test(uploadId)) throw new Response('invalid upload id', { status: 400 })
    return path.join(this.dataRoot, 'uploads', `${uploadId}.preview.part`)
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
    await this.syncDirectory(directory)
  }

  async sweepUploads(exclude: ReadonlySet<string> = new Set()) {
    const directory = path.join(this.dataRoot, 'uploads')
    await fs.promises.mkdir(directory, { recursive: true })
    for (const name of await fs.promises.readdir(directory)) {
      const match = /^([a-z0-9-]{10,64})(?:\.preview)?\.part$/i.exec(name)
      if (!match) continue
      if (exclude.has(match[1])) continue
      const file = path.join(directory, name)
      const stat = await fs.promises.stat(file).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined
        throw error
      })
      if (stat && Date.now() - stat.mtimeMs > 86_400_000) await fs.promises.rm(file, { force: true })
    }
  }

  async writable() {
    await Promise.all([this.assertWritable(this.root), this.assertWritable(this.dataRoot)])
  }

  private async assertWritable(directory: string) {
    const probe = path.join(directory, `.printhub-health-${crypto.randomUUID()}`)
    await fs.promises.writeFile(probe, '')
    await fs.promises.rm(probe, { force: true })
  }

  private async syncDirectory(directory: string) {
    const handle = await fs.promises.open(directory, 'r')
    try { await handle.sync() } finally { await handle.close() }
  }
}
