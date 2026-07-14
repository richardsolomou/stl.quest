import { Upload } from 'tus-js-client'
import type { UploadEntry } from './uploadTypes'

const CHUNK_BYTES = 32 * 1024 * 1024

export async function uploadPrint(entry: UploadEntry, requesterName: string, onProgress: (sent: number, total: number) => void) {
  const metadata: Record<string, string> = {
    filename: entry.file.name,
    name: entry.name.trim() || entry.file.name.replace(/\.stl$/i, ''),
    quantity: String(Math.min(50, Math.max(1, Math.round(Number(entry.quantity) || 1)))),
    requesterName,
  }
  if (entry.notes.trim()) metadata.notes = entry.notes.trim()
  if (entry.sourceUrl.trim()) metadata.sourceUrl = entry.sourceUrl.trim()
  if (entry.printerId) metadata.printerId = entry.printerId
  const upload = new Upload(entry.file, {
    endpoint: '/api/upload',
    chunkSize: CHUNK_BYTES,
    retryDelays: [0, 1000, 3000, 5000],
    removeFingerprintOnSuccess: true,
    fingerprint: async (file) =>
      [
        'printhub',
        file.name,
        file.type,
        file.size,
        file.lastModified,
        entry.name,
        entry.quantity,
        requesterName,
        entry.notes,
        entry.sourceUrl,
        entry.printerId,
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
