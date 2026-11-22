import { PassThrough, Readable } from 'node:stream'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { ZipArchive } from 'archiver'
import PQueue from 'p-queue'
import { formatBytes } from '../core/format'
import { parseModelPositions } from '../core/mesh/model'
import {
  arrangeFootprints,
  plateMesh,
  THREE_MF_CONTENT_TYPES,
  THREE_MF_RELATIONSHIPS,
  threeMfBuildXml,
  threeMfModelEnd,
  threeMfModelStart,
  threeMfObjectXml,
} from '../core/mesh/threeMfWriter'
import { MAX_PLATE_FILE_BYTES } from '../core/plates'
import type { AssetStore, Identity } from '../core/types'
import type { STLQuestService } from '../core/services'
import { requestLocale, serverMessages } from './locale'

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
  for (const { path } of listed.models) {
    const stored = await context.assets.stat(path).catch(() => undefined)
    if (!stored) throw new Response(serverMessages().server.access.notFound, { status: 404 })
    bytes += stored.size
  }
  if (bytes > MAX_PLATE_FILE_BYTES)
    throw new Response(serverMessages().server.plates.tooLarge(formatBytes(MAX_PLATE_FILE_BYTES, requestLocale())), { status: 413 })
  return { ...listed, copies: listed.models.reduce((total, { copies }) => total + copies, 0) }
}

// One plate at a time: each model is parsed whole, so concurrent builds would multiply the largest model's memory.
const builds = new PQueue({ concurrency: 1 })

/**
 * The plate as one 3MF, streamed as it is built: each model is read, converted, and written before the next is read, so
 * memory holds one model at a time. A model that cannot be read as a mesh fails the stream rather than leave it out.
 */
export function plateThreeMf(assets: Pick<AssetStore, 'read'>, models: PlateFileModel[]): ReadableStream {
  const output = new PassThrough()
  const archive = new ZipArchive({ zlib: { level: 1 } })
  const model = Readable.from(modelXml(assets, models))
  archive.on('error', (error) => output.destroy(error))
  model.once('error', (error) => output.destroy(error))
  output.once('close', () => {
    archive.abort()
    model.destroy()
  })
  archive.pipe(output)
  archive.append(THREE_MF_CONTENT_TYPES, { name: '[Content_Types].xml' })
  archive.append(THREE_MF_RELATIONSHIPS, { name: '_rels/.rels' })
  archive.append(model, { name: '3D/3dmodel.model' })
  archive.finalize().catch((error) => output.destroy(error))
  return Readable.toWeb(output) as ReadableStream
}

async function* modelXml(assets: Pick<AssetStore, 'read'>, models: PlateFileModel[]) {
  let release!: () => void
  const built = new Promise<void>((resolve) => (release = resolve))
  await new Promise<void>((started) => void builds.add(() => (started(), built)))
  try {
    yield threeMfModelStart()
    const copies: { objectId: number; width: number; depth: number }[] = []
    for (const [index, { name, path, copies: count }] of models.entries()) {
      const asset = await assets.read(path)
      const mesh = plateMesh(parseModelPositions(new Uint8Array(await new Response(asset.stream).arrayBuffer())))
      for (const chunk of threeMfObjectXml(index + 1, name, mesh)) {
        yield chunk
        // Text for a large model takes a while to write, so other requests get a turn between chunks.
        await nextTurn()
      }
      for (let copy = 0; copy < count; copy++) copies.push({ objectId: index + 1, width: mesh.width, depth: mesh.depth })
    }
    const placed = arrangeFootprints(copies, COPY_GAP)
    yield threeMfBuildXml(copies.map(({ objectId }, index) => ({ objectId, ...placed[index] })))
    yield threeMfModelEnd()
  } finally {
    release()
  }
}
