import crypto from 'node:crypto'
import { initialStatus, statusById } from './workflow'

// Keys are storage-agnostic, '/'-separated paths shared by every AssetStore.
const baseName = (key: string) => key.split('/').pop() ?? key

export function createAssetKey(originalFileName: string) {
  const base =
    baseName(originalFileName)
      .replace(/\.stl$/i, '')
      .replace(/[^\w.\- ]+/g, '_')
      .trim()
      .slice(0, 120) || 'model'
  return `${initialStatus().folder}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}__${base}.stl`
}

export function previewKey(originalKey: string) {
  return `.stlquest/previews/${baseName(originalKey).replace(/\.stl$/i, '')}.phm`
}

const THUMBNAIL_EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' }

export function thumbnailKey(originalKey: string, mime: string) {
  const extension = THUMBNAIL_EXTENSIONS[mime]
  if (!extension) throw new Response('unsupported thumbnail type', { status: 400 })
  return `.stlquest/thumbnails/${baseName(originalKey).replace(/\.stl$/i, '')}.${extension}`
}

export function thumbnailMime(key: string) {
  const extension = key.split('.').pop()
  return Object.entries(THUMBNAIL_EXTENSIONS).find(([, value]) => value === extension)?.[0] ?? 'image/png'
}

export function destinationKey(key: string, statusId: string) {
  return `${statusById(statusId).folder}/${baseName(key)}`
}

export function trashKey(operationId: string, key: string) {
  if (!/^[a-f0-9-]{36}$/i.test(operationId)) throw new Error('invalid operation id')
  const assetId = crypto.createHash('sha256').update(key).digest('hex').slice(0, 16)
  return `.stlquest/trash/${operationId}__${assetId}__${baseName(key)}`
}
