import { defaultOptions, Upload } from 'tus-js-client'
import type { UploadEntry } from './uploadTypes'

const CHUNK_BYTES = 32 * 1024 * 1024

export async function uploadPrint(workspaceSlug: string, entry: UploadEntry, onProgress: (sent: number, total: number) => void) {
  const metadata: Record<string, string> = {
    filename: entry.file.name,
    name: entry.name.trim() || entry.file.name.replace(/\.stl$/i, ''),
    quantity: String(Math.min(50, Math.max(1, Math.round(Number(entry.quantity) || 1)))),
  }
  if (!entry.printType) throw new Error('Choose resin or filament for every model')
  metadata.requestedPrintType = entry.printType
  if (entry.notes.trim()) metadata.notes = entry.notes.trim()
  if (entry.sourceUrl.trim()) metadata.sourceUrl = entry.sourceUrl.trim()
  const upload = new Upload(entry.file, {
    endpoint: '/api/upload',
    chunkSize: CHUNK_BYTES,
    retryDelays: [0, 1000, 3000, 5000],
    onShouldRetry: (error, retryAttempt, options) =>
      error.originalResponse?.getStatus() !== 423 && defaultOptions.onShouldRetry?.(error, retryAttempt, options) === true,
    removeFingerprintOnSuccess: true,
    fingerprint: async (file) =>
      [
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
      ].join('-'),
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

export function uploadErrorMessage(error: unknown) {
  const response = (error as { originalResponse?: { getStatus(): number; getBody(): string } | null }).originalResponse
  if (response?.getStatus() === 423) {
    const detail = responseError(response.getBody())
    if (detail === 'storage migration is in progress — uploads are temporarily paused') {
      return 'Uploads are paused while storage is moving. Wait for the migration to finish.'
    }
  }
  const detail = error instanceof Error ? error.message : 'Upload failed.'
  return detail
}

function responseError(body: string) {
  try {
    const parsed = JSON.parse(body) as { error?: unknown }
    return typeof parsed.error === 'string' ? parsed.error : undefined
  } catch {
    return undefined
  }
}
