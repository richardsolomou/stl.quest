import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'
import { ZipArchive } from 'archiver'
import PQueue from 'p-queue'
import { formatBytes } from '../core/format'
import {
  arrangeFootprints,
  THREE_MF_CONTENT_TYPES,
  THREE_MF_RELATIONSHIPS,
  threeMfBuildXml,
  threeMfModelEnd,
  threeMfModelStart,
} from '../core/mesh/threeMfWriter'
import { MAX_PLATE_FILE_BYTES } from '../core/plates'
import type { AssetStore, Identity } from '../core/types'
import type { STLQuestService } from '../core/services'
import type { AssetGenerationQueue } from './assets/queue'
import { requestLocale, serverMessages } from './locale'
import { logger } from './logger'
import { SLICER_LINK_TTL_MS } from './slicerLinks'

/** Room between copies, in millimetres, so the slicer opens the plate with nothing overlapping. */
const COPY_GAP = 5

export type PlateFileModel = { requestId: string; name: string; path: string; copies: number }

/** A plate's models once each is in storage and together they fit in one file, or the Response saying why not. */
export async function checkedPlateModels(
  context: {
    service: Pick<STLQuestService, 'plateModels'>
    assets: Pick<AssetStore, 'stat'>
    identity: Pick<Identity, 'role'>
  },
  plateId: string,
) {
  const listed = await context.service.plateModels(plateId, context.identity)
  let bytes = 0
  for (const model of listed.models) {
    const stored = await context.assets.stat(model.path).catch(() => undefined)
    if (!stored) throw new Response(serverMessages().server.access.notFound, { status: 404 })
    bytes += stored.size
  }
  if (bytes > MAX_PLATE_FILE_BYTES)
    throw new Response(serverMessages().server.plates.tooLarge(formatBytes(MAX_PLATE_FILE_BYTES, requestLocale())), { status: 413 })
  return { ...listed, copies: listed.models.reduce((total, { copies }) => total + copies, 0) }
}

/** A model on the plate that could not be converted, so the plate file was not built. */
export class PlateModelError extends Error {
  constructor(
    readonly model: PlateFileModel,
    cause: unknown,
  ) {
    super(`plate model ${model.requestId} could not be converted`, { cause })
  }
}

type BuiltPlate = { file: Promise<string>; expiry?: ReturnType<typeof setTimeout> }

/**
 * A workspace's plate files, each built whole into a temporary file before anything is sent, so a failed conversion
 * is an error response rather than a truncated download, and a slow client only holds its own file open. A built file
 * is kept as long as the link that fetched it works, keyed by the plate and what is on it, so fetching again reuses it.
 */
export class PlateFiles {
  // One build at a time per workspace; each model's conversion also waits for the asset worker's memory budget.
  private builds = new PQueue({ concurrency: 1 })
  private built = new Map<string, BuiltPlate>()

  constructor(
    private converter: Pick<AssetGenerationQueue, 'writePlateObject'>,
    private keepMs = SLICER_LINK_TTL_MS,
  ) {}

  async open(plateId: string, models: PlateFileModel[]) {
    const key = JSON.stringify([plateId, models])
    let entry = this.built.get(key)
    if (!entry) {
      const built: BuiltPlate = { file: this.builds.add(() => this.build(models)) }
      this.built.set(key, built)
      built.file.then(
        () => {
          built.expiry = setTimeout(() => void this.discard(key), this.keepMs)
          built.expiry.unref()
        },
        () => this.built.delete(key),
      )
      entry = built
    }
    // Opened before returning, so the file outlives its expiry for as long as this response reads it.
    const handle = await fs.promises.open(await entry.file)
    const { size } = await handle.stat()
    return { stream: Readable.toWeb(handle.createReadStream()) as ReadableStream, size }
  }

  async close() {
    this.builds.clear()
    await this.builds.onIdle()
    await Promise.all([...this.built.keys()].map((key) => this.discard(key)))
  }

  private async discard(key: string) {
    const entry = this.built.get(key)
    if (!entry) return
    this.built.delete(key)
    clearTimeout(entry.expiry)
    const file = await entry.file.catch(() => undefined)
    if (file) await fs.promises.rm(path.dirname(file), { recursive: true, force: true })
  }

  private async build(models: PlateFileModel[]) {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-plate-'))
    try {
      const xmlPath = path.join(directory, '3dmodel.model')
      await fs.promises.writeFile(xmlPath, threeMfModelStart())
      const copies: { objectId: number; width: number; depth: number }[] = []
      for (const [index, model] of models.entries()) {
        const footprint = await this.converter.writePlateObject(model.path, { id: index + 1, name: model.name }, xmlPath).catch((error) => {
          logger.warn({ err: error, event: 'plate_file_model_failed', request_id: model.requestId }, 'plate file model conversion failed')
          throw new PlateModelError(model, error)
        })
        for (let copy = 0; copy < model.copies; copy++) copies.push({ objectId: index + 1, ...footprint })
      }
      const placed = arrangeFootprints(copies, COPY_GAP)
      await fs.promises.appendFile(
        xmlPath,
        threeMfBuildXml(copies.map(({ objectId }, index) => ({ objectId, ...placed[index] }))) + threeMfModelEnd(),
      )
      const file = path.join(directory, 'plate.3mf')
      const output = fs.createWriteStream(file)
      const archive = new ZipArchive({ zlib: { level: 1 } })
      archive.pipe(output)
      archive.append(THREE_MF_CONTENT_TYPES, { name: '[Content_Types].xml' })
      archive.append(THREE_MF_RELATIONSHIPS, { name: '_rels/.rels' })
      archive.append(fs.createReadStream(xmlPath), { name: '3D/3dmodel.model' })
      await Promise.all([archive.finalize(), finished(output)])
      await fs.promises.rm(xmlPath)
      return file
    } catch (error) {
      await fs.promises.rm(directory, { recursive: true, force: true })
      throw error
    }
  }
}
