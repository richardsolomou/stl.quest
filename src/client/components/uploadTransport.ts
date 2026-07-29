import { defaultOptions, Upload } from 'tus-js-client'
import type { UploadEntry } from './uploadTypes'
import { normalizeRequestQuantity } from '../../core/request'
import { errorMessage } from '../error'

const CHUNK_BYTES = 32 * 1024 * 1024

export async function uploadPrint(workspaceSlug: string, entry: UploadEntry, onProgress: (sent: number, total: number) => void) {
  const metadata = uploadMetadata(entry)
  const upload = new Upload(entry.file, {
    endpoint: '/api/upload',
    chunkSize: CHUNK_BYTES,
    retryDelays: [0, 1000, 3000, 5000],
    onShouldRetry: (error, retryAttempt, options) =>
      error.originalResponse?.getStatus() !== 423 && defaultOptions.onShouldRetry?.(error, retryAttempt, options) === true,
    removeFingerprintOnSuccess: true,
    fingerprint: async (file) => uploadFingerprint(workspaceSlug, entry, file),
    metadata,
    onProgress,
  })
  const previous = await upload.findPreviousUploads()
  if (previous[0]) upload.resumeFromPreviousUpload(previous[0])
  await new Promise<void>((resolve, reject) => {
    upload.options.onSuccess = () => resolve()
    upload.options.onError = reject
    upload.start()
  })
}

export function uploadMetadata(entry: UploadEntry) {
  const metadata: Record<string, string> = {
    filename: entry.file.name,
    name: entry.name.trim() || entry.file.name.replace(/\.stl$/i, ''),
    quantity: String(normalizeRequestQuantity(entry.quantity)),
  }
  if (!entry.printType) throw new Error('Choose resin or filament for every model')
  metadata.requestedPrintType = entry.printType
  if (entry.notes.trim()) metadata.notes = entry.notes.trim()
  if (entry.sourceUrl.trim()) metadata.sourceUrl = entry.sourceUrl.trim()
  return metadata
}

export function uploadFingerprint(workspaceSlug: string, entry: UploadEntry, file = entry.file) {
  return [
    'stlquest',
    workspaceSlug,
    file.name,
    file.type,
    file.size,
    file.lastModified,
    entry.name,
    entry.quantity,
    entry.notes,
    entry.sourceUrl,
    entry.printType,
  ].join('-')
}

export function uploadErrorMessage(error: unknown) {
  const response = (error as { originalResponse?: { getStatus(): number; getBody(): string } | null }).originalResponse
  if (response?.getStatus() === 423) {
    const detail = responseError(response.getBody())
    if (detail === 'storage migration is in progress — uploads are temporarily paused') {
      return 'Uploads are paused while storage is moving. Wait for the migration to finish.'
    }
  }
  return errorMessage(error, 'Upload failed.')
}

function responseError(body: string) {
  try {
    const parsed = JSON.parse(body) as { error?: unknown }
    return typeof parsed.error === 'string' ? parsed.error : undefined
  } catch {
    return undefined
  }
}
