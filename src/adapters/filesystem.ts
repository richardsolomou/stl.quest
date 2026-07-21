import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { AssetStore } from '../core/types'
import { createAssetKey, destinationKey, previewKey, trashKey } from '../core/assetKeys'
import { workflow } from '../core/workflow'

export class LocalAssetStore implements AssetStore {
  readonly root: string

  constructor(root = '/prints') {
    this.root = path.resolve(root)
  }

  async initialize() {
    await Promise.all([
      ...workflow.statuses.map((status) => fs.promises.mkdir(path.join(this.root, status.folder), { recursive: true })),
      fs.promises.mkdir(path.join(this.root, '.stlquest', 'previews'), { recursive: true }),
      fs.promises.mkdir(path.join(this.root, '.stlquest', 'thumbnails'), { recursive: true }),
      fs.promises.mkdir(path.join(this.root, '.stlquest', 'trash'), { recursive: true }),
    ])
  }

  absolute(relativePath: string) {
    const resolved = path.resolve(this.root, relativePath)
    if (resolved !== this.root && !resolved.startsWith(this.root + path.sep)) throw new Response('invalid path', { status: 400 })
    return resolved
  }

  createPath(originalFileName: string) {
    return createAssetKey(originalFileName)
  }

  previewPath(originalRelativePath: string) {
    return previewKey(originalRelativePath)
  }

  async finalizeUpload(stagedPath: string, relativePath: string) {
    const destination = this.absolute(relativePath)
    await fs.promises.mkdir(path.dirname(destination), { recursive: true })
    const sourceDirectory = path.dirname(stagedPath)
    const [sourceExists, destinationExists] = await Promise.all([
      fs.promises
        .stat(stagedPath)
        .then(() => true)
        .catch((error: NodeJS.ErrnoException) => (error.code === 'ENOENT' ? false : Promise.reject(error))),
      this.exists(relativePath),
    ])
    if (!sourceExists && destinationExists) return
    if (!sourceExists) throw Object.assign(new Error(`upload part missing: ${stagedPath}`), { code: 'ENOENT' })
    if (destinationExists) throw new Error(`upload destination already exists: ${relativePath}`)
    try {
      const handle = await fs.promises.open(stagedPath, 'r')
      try {
        await handle.sync()
      } finally {
        await handle.close()
      }
      await fs.promises.rename(stagedPath, destination)
      await this.syncDirectory(path.dirname(destination))
      if (sourceDirectory !== path.dirname(destination)) await this.syncDirectory(sourceDirectory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
      const temporary = `${destination}.${crypto.randomUUID()}.tmp`
      try {
        try {
          await fs.promises.copyFile(stagedPath, temporary, fs.constants.COPYFILE_EXCL)
        } catch (copyError) {
          if ((copyError as NodeJS.ErrnoException).code !== 'EPERM') throw copyError
          await fs.promises.rm(temporary, { force: true })
          await pipeline(fs.createReadStream(stagedPath), fs.createWriteStream(temporary, { flags: 'wx' }))
        }
        const handle = await fs.promises.open(temporary, 'r')
        try {
          await handle.sync()
        } finally {
          await handle.close()
        }
        await fs.promises.rename(temporary, destination)
        await this.syncDirectory(path.dirname(destination))
        await fs.promises.unlink(stagedPath)
        await this.syncDirectory(sourceDirectory)
      } catch (copyError) {
        await fs.promises.rm(temporary, { force: true }).catch(() => undefined)
        throw copyError
      }
    }
  }

  async write(relativePath: string, bytes: Uint8Array) {
    const destination = this.absolute(relativePath)
    const directory = path.dirname(destination)
    await fs.promises.mkdir(directory, { recursive: true })
    const handle = await fs.promises.open(destination, 'w')
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await this.syncDirectory(directory)
  }

  async writeStream(relativePath: string, stream: ReadableStream, size: number) {
    const destination = this.absolute(relativePath)
    const directory = path.dirname(destination)
    const temporary = `${destination}.${crypto.randomUUID()}.tmp`
    await fs.promises.mkdir(directory, { recursive: true })
    try {
      await pipeline(Readable.fromWeb(stream as import('node:stream/web').ReadableStream), fs.createWriteStream(temporary, { flags: 'wx' }))
      const handle = await fs.promises.open(temporary, 'r')
      try {
        const stat = await handle.stat()
        if (stat.size !== size) throw new Error(`asset size changed while copying: ${relativePath}`)
        await handle.sync()
      } finally {
        await handle.close()
      }
      await fs.promises.rename(temporary, destination)
      await this.syncDirectory(directory)
    } catch (error) {
      await fs.promises.rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }

  async read(relativePath: string) {
    const filePath = this.absolute(relativePath)
    const size = (await fs.promises.stat(filePath)).size
    return { stream: Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream, size }
  }

  async stat(relativePath: string) {
    try {
      return { size: (await fs.promises.stat(this.absolute(relativePath))).size }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  async move(relativePath: string, statusId: string) {
    const next = this.destinationPath(relativePath, statusId)
    await this.ensureMoved(relativePath, next)
    return next
  }

  destinationPath(relativePath: string, statusId: string) {
    return destinationKey(relativePath, statusId)
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
    return fs.promises
      .stat(this.absolute(relativePath))
      .then(() => true)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false
        throw error
      })
  }

  async remove(relativePath: string) {
    await fs.promises.rm(this.absolute(relativePath), { force: true })
  }

  async trash(relativePath: string) {
    const source = this.absolute(relativePath)
    const trashPath = `.stlquest/trash/${crypto.randomUUID()}__${path.basename(relativePath)}`
    try {
      await fs.promises.rename(source, this.absolute(trashPath))
      return trashPath
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  trashPath(operationId: string, relativePath: string) {
    return trashKey(operationId, relativePath)
  }

  async purgeTrash(trashPath: string) {
    await this.remove(trashPath)
  }

  async sweepTrash() {
    const directory = this.absolute('.stlquest/trash')
    await fs.promises.mkdir(directory, { recursive: true })
    for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
      if (entry.isFile()) await fs.promises.rm(path.join(directory, entry.name), { force: true })
    }
  }

  async writable() {
    const probe = path.join(this.root, `.stlquest-health-${crypto.randomUUID()}`)
    await fs.promises.writeFile(probe, '')
    await fs.promises.rm(probe, { force: true })
  }

  private async syncDirectory(directory: string) {
    const handle = await fs.promises.open(directory, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  }
}
