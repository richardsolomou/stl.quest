import { Upload } from 'tus-js-client'
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
    removeFingerprintOnSuccess: true,
    fingerprint: async (file) =>
      [
        'printhub',
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
