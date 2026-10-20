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
  return startTusUpload(upload, { ...(signal ? { signal } : {}), terminateOnAbort: true })
}

export function isUploadCancelled(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function uploadMetadata(entry: UploadEntry) {
  const metadata: Record<string, string> = {
    filename: entry.file.name,
    name: entry.name.trim() || entry.file.name.replace(/\.(?:stl|3mf|obj)$/i, ''),
    quantity: String(normalizeRequestQuantity(entry.quantity)),
  }
  if (!entry.printType) throw new Error('Choose resin or filament for every model')
  metadata.requestedPrintType = entry.printType
  if (entry.notes.trim()) metadata.notes = entry.notes.trim()
  if (entry.sourceUrl.trim()) metadata.sourceUrl = entry.sourceUrl.trim()
  if (entry.attachToRequestId) metadata.attachToRequestId = entry.attachToRequestId
  return metadata
}

export function uploadFingerprint(workspaceSlug: string, entry: UploadEntry, file = entry.file) {
  const parts: (string | number)[] = [
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
  ]
  // Appended only when attaching, so uploads already in flight keep resuming across an upgrade.
  if (entry.attachToRequestId) parts.push(entry.attachToRequestId)
  return parts.join('-')
}

type UploadRejection = 'proxy_blocked' | 'proxy_unavailable' | 'storage_paused' | 'upload_limit' | 'storage_quota'

// An answer the upload dialog can explain to the person, so it is an expected rejection rather than a fault.
export function uploadRejection(error: unknown): UploadRejection | undefined {
  const response = uploadResponse(error)
  if (!response) return undefined
  const status = response.getStatus()
  // STL Quest answers uploads with JSON or plain text, so an HTML page comes from a proxy or firewall in front of it.
  if (response.getBody().trimStart().startsWith('<')) return status >= 500 ? 'proxy_unavailable' : 'proxy_blocked'
  if (status === 423 && responseError(response.getBody()) === 'storage migration is in progress — uploads are temporarily paused') {
    return 'storage_paused'
  }
  if (status === 429) return 'upload_limit'
  // A 413 from the upload endpoint always means the plan allowance was the limit.
  if (status === 413) return 'storage_quota'
  return undefined
}

export function uploadErrorMessage(error: unknown) {
  const response = uploadResponse(error)
  switch (uploadRejection(error)) {
    case 'proxy_blocked':
      return `A proxy or firewall in front of STL Quest blocked this upload (HTTP ${response?.getStatus()}). Ask your server admin to allow upload requests to /api/upload.`
    case 'proxy_unavailable':
      return `STL Quest did not answer through its proxy (HTTP ${response?.getStatus()}). Try again in a moment.`
    case 'storage_paused':
      return 'Uploads are paused while storage is moving. Wait for the migration to finish.'
    case 'upload_limit':
      return 'Too many uploads are still in progress. Wait for one to finish, then try again.'
    case 'storage_quota':
      return responseError(response?.getBody() ?? '') === 'managed storage quota exceeded'
        ? 'This model is larger than your whole storage allowance.'
        : 'Not enough storage left for this model.'
  }
  return errorMessage(error, 'Upload failed.')
}

function uploadResponse(error: unknown) {
  return (error as { originalResponse?: { getStatus(): number; getBody(): string } | null } | undefined)?.originalResponse
}

function responseError(body: string) {
  try {
    const parsed = JSON.parse(body) as { error?: unknown }
    return typeof parsed.error === 'string' ? parsed.error : undefined
  } catch {
    return undefined
  }
}
