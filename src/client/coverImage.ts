import { COVER_WIDTH } from '../core/coverImage'
import { base64 } from './base64'

/** The browser could not decode the file, so it is not an image it can turn into a cover. */
export class UnreadableCover extends Error {}

/** What a file dropped on an open print does: an image becomes a linked print's cover, anything else its model. */
export function droppedFileRole(request: { hasFile: boolean }, type: string) {
  if (!type.startsWith('image/')) return 'model'
  return request.hasFile ? undefined : 'cover'
}

export function firstImage(files: Iterable<File> | ArrayLike<File>) {
  return Array.from(files).find((file) => file.type.startsWith('image/'))
}

/**
 * Redraws a chosen or pasted picture at cover size, so a full-size copy from a model page fits the size limit
 * and leaves its camera metadata behind, then returns it base64-encoded for the server function.
 */
export async function encodeCover(file: Blob) {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new UnreadableCover()
  })
  const scale = Math.min(1, COVER_WIDTH / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  // A browser that cannot encode WebP returns PNG, which the server accepts too.
  const encoded = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.86))
  if (!encoded) throw new UnreadableCover()
  return await base64(encoded)
}
