import { uploadFile } from '../uploads'
import type { UploadEntry } from './uploadTypes'
import { stripModelExtension } from '../../core/assetKeys'
import { normalizeRequestQuantity } from '../../core/request'
import { errorMessage } from '../../core/error'
import type { Messages } from '../../core/i18n'

export async function uploadPrint(
  workspaceSlug: string,
  entry: UploadEntry,
  onProgress: (sent: number, total: number) => void,
  signal?: AbortSignal,
) {
  return uploadFile(entry.file, {
    metadata: uploadMetadata(entry),
    onProgress: ({ sent, total }) => onProgress(sent, total),
    signal,
    // A storage migration answers 423 until it finishes, so retrying would only fail again.
    shouldRetry: (status) => status !== 423,
    fingerprint: async (file) => uploadFingerprint(workspaceSlug, entry, file),
  })
}

export function isUploadCancelled(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function uploadMetadata(entry: UploadEntry) {
  const metadata: Record<string, string> = {
    filename: entry.file.name,
    name: entry.name.trim() || stripModelExtension(entry.file.name),
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

type UploadRejection =
  | 'file_unreadable'
  | 'proxy_blocked'
  | 'proxy_unavailable'
  | 'storage_paused'
  | 'upload_limit'
  | 'server_busy'
  | 'storage_quota'

// An answer the upload dialog can explain to the person, so it is an expected rejection rather than a fault.
export function uploadRejection(error: unknown): UploadRejection | undefined {
  // Chrome reports a moved or deleted file as NotFoundError and a changed one as NotReadableError.
  if (error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'NotReadableError')) return 'file_unreadable'
  const response = uploadResponse(error)
  if (!response) return undefined
  const status = response.getStatus()
  // STL Quest answers uploads with JSON or plain text, so an HTML page comes from a proxy or firewall in front of it.
  if (response.getBody().trimStart().startsWith('<')) return status >= 500 ? 'proxy_unavailable' : 'proxy_blocked'
  if (status === 423 && responseError(response.getBody()) === 'storage migration is in progress — uploads are temporarily paused') {
    return 'storage_paused'
  }
  if (status === 429) return responseError(response.getBody()) === 'too many concurrent upload requests' ? 'server_busy' : 'upload_limit'
  // A 413 from the upload endpoint always means the plan allowance was the limit.
  if (status === 413) return 'storage_quota'
  return undefined
}

export function uploadErrorMessage(error: unknown, t: Messages['requests']) {
  const response = uploadResponse(error)
  switch (uploadRejection(error)) {
    case 'file_unreadable':
      return t.transport.fileUnreadable
    case 'proxy_blocked':
      return t.transport.proxyBlocked(response?.getStatus())
    case 'proxy_unavailable':
      return t.transport.proxyUnavailable(response?.getStatus())
    case 'storage_paused':
      return t.transport.storagePaused
    case 'upload_limit':
      return t.transport.uploadLimit
    case 'server_busy':
      return t.transport.serverBusy
    case 'storage_quota':
      return responseError(response?.getBody() ?? '') === 'managed storage quota exceeded'
        ? t.transport.largerThanAllowance
        : t.transport.notEnoughStorage
  }
  return errorMessage(error, t.transport.failed)
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
