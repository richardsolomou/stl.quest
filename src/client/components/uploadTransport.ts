import { createTusUpload, startTusUpload } from 'ras-stack/uploads'
import type { UploadEntry } from './uploadTypes'
import { normalizeRequestQuantity } from '../../core/request'
import { errorMessage } from '../../core/error'

const CHUNK_BYTES = 32 * 1024 * 1024

export async function uploadPrint(
  workspaceSlug: string,
  entry: UploadEntry,
  onProgress: (sent: number, total: number) => void,
  signal?: AbortSignal,
) {
  const metadata = uploadMetadata(entry)
  const upload = createTusUpload({
    file: entry.file,
    endpoint: '/api/upload',
    chunkSize: CHUNK_BYTES,
    retryDelays: [0, 1000, 3000, 5000],
    shouldRetry: (status) => status !== 423,
    removeFingerprintOnSuccess: true,
    fingerprint: async (file) => uploadFingerprint(workspaceSlug, entry, file),
    metadata,
    onProgress: ({ sent, total }) => onProgress(sent, total),
  })
  if (!signal) return startTusUpload(upload)
  if (signal.aborted) throw abortError()
  let rejectAbort: (reason: Error) => void = () => undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject
  })
  const abort = () => {
    void upload.abort(true).then(
      () => rejectAbort(abortError()),
      (error) => rejectAbort(error instanceof Error ? error : abortError()),
    )
  }
  signal.addEventListener('abort', abort, { once: true })
  try {
    return await Promise.race([startTusUpload(upload), aborted])
  } finally {
    signal.removeEventListener('abort', abort)
  }
}

export function isUploadCancelled(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function abortError() {
  return new DOMException('Upload cancelled', 'AbortError')
}

export function uploadMetadata(entry: UploadEntry) {
  const metadata: Record<string, string> = {
    filename: entry.file.name,
    name: entry.name.trim() || entry.file.name.replace(/\.(?:stl|3mf)$/i, ''),
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
  if (isStorageQuotaError(error)) {
    return responseError(response?.getBody() ?? '') === 'managed storage quota exceeded'
      ? 'This model is larger than your whole storage allowance.'
      : 'Not enough storage left for this model.'
  }
  return errorMessage(error, 'Upload failed.')
}

// A 413 from the upload endpoint always means the plan allowance was the limit.
export function isStorageQuotaError(error: unknown) {
  const response = (error as { originalResponse?: { getStatus(): number } | null }).originalResponse
  return response?.getStatus() === 413
}

function responseError(body: string) {
  try {
    const parsed = JSON.parse(body) as { error?: unknown }
    return typeof parsed.error === 'string' ? parsed.error : undefined
  } catch {
    return undefined
  }
}
