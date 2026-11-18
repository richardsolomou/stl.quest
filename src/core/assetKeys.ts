// Keys are storage-agnostic, '/'-separated paths shared by every AssetStore.
const baseName = (key: string) => key.split('/').pop() ?? key
export const STORAGE_SCAFFOLD_FOLDERS = ['models', 'previews', 'thumbnails', 'covers', 'trash'] as const
const STORAGE_SCAFFOLD = new Set<string>(STORAGE_SCAFFOLD_FOLDERS)

export function isStorageScaffoldFolder(relativePath: string) {
  return STORAGE_SCAFFOLD.has(relativePath)
}

export const MODEL_FORMATS = ['stl', '3mf', 'obj'] as const
export type ModelFormat = (typeof MODEL_FORMATS)[number]
const MODEL_EXTENSION = new RegExp(`\\.(${MODEL_FORMATS.join('|')})$`, 'i')

export function modelFormat(fileName: string) {
  return fileName.match(MODEL_EXTENSION)?.[1]?.toLowerCase() as ModelFormat | undefined
}

export function stripModelExtension(fileName: string) {
  return fileName.replace(MODEL_EXTENSION, '')
}

function assertUuid(value: string, kind: string) {
  if (!/^[a-f0-9-]{36}$/i.test(value)) throw new Error(`invalid ${kind} id`)
}

export function createAssetKey(requestId: string, originalFileName: string) {
  assertUuid(requestId, 'request')
  const extension = modelFormat(originalFileName) ?? 'stl'
  const base =
    stripModelExtension(baseName(originalFileName))
      .replace(/[^\w.\- ]+/g, '_')
      .trim()
      .slice(0, 120) || 'model'
  return `models/${requestId}__${base}.${extension}`
}

// Extension-less and derived only from the request id: a refetch overwrites the same object instead of
// orphaning one under a new extension. The stored bytes carry their own magic number, so the served
// content type is detected on read.
export function sourceImageKey(requestId: string) {
  assertUuid(requestId, 'request')
  return `covers/${requestId}`
}

export function previewKey(originalKey: string) {
  return `previews/${stripModelExtension(baseName(originalKey))}.phm`
}

const THUMBNAIL_EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' }

export function thumbnailKey(originalKey: string, mime: string) {
  const extension = THUMBNAIL_EXTENSIONS[mime]
  if (!extension) throw new Response('unsupported thumbnail type', { status: 400 })
  return `thumbnails/${stripModelExtension(baseName(originalKey))}.${extension}`
}

export function thumbnailMime(key: string) {
  const extension = key.split('.').pop()
  return Object.entries(THUMBNAIL_EXTENSIONS).find(([, value]) => value === extension)?.[0] ?? 'image/png'
}

export function assetContentType(key: string) {
  const extension = key.split('.').pop()?.toLowerCase()
  if (extension === 'stl') return 'model/stl'
  if (extension === '3mf') return 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml'
  if (extension === 'obj') return 'model/obj'
  if (extension === 'png') return 'image/png'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'phm') return 'application/x-stlquest-preview'
  return 'application/octet-stream'
}

export function trashKey(operationId: string, key: string, assetId: string) {
  assertUuid(operationId, 'operation')
  return `trash/${operationId}__${assetId}__${baseName(key)}`
}
