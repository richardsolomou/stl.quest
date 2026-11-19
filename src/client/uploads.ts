import { defaultOptions, Upload } from 'tus-js-client'
import { appPath } from '../basePath'

export type UploadProgress = { sent: number; total: number }

export type UploadFileOptions = {
  /** Sent to the server as tus metadata; `acceptUpload` requires `filename`. */
  metadata?: Record<string, string>
  onProgress?: (progress: UploadProgress) => void
  /** Aborting cancels the upload and deletes it on the server, so it stops counting against the owner's limits. */
  signal?: AbortSignal
  /** Identifies the upload to resume; tus-js-client's default uses the file's name, type, size, and modification time. */
  fingerprint?: (file: File) => Promise<string>
  /** Whether a request that answered `status` may be retried; tus-js-client's own rules still apply. */
  shouldRetry?: (status: number | undefined) => boolean
}

// Proxies in front of the app, such as Cloudflare's, cap request bodies at 100 MB, and a smaller chunk loses less on a retry.
const chunkSize = 32 * 1024 * 1024

/**
 * Uploads `file` to `/api/upload`, resuming an earlier interrupted upload of the same file. Resolves with the upload's URL,
 * whose last segment is its id; rejects with an `AbortError` when `signal` aborts, or with tus-js-client's error, whose
 * `originalResponse` carries the server's status and message.
 */
export async function uploadFile(file: File, { metadata = {}, onProgress, signal, fingerprint, shouldRetry }: UploadFileOptions = {}) {
  if (signal?.aborted) throw abortError()
  const upload = new Upload(file, {
    endpoint: appPath('/api/upload'),
    metadata: { filename: file.name, filetype: file.type, ...metadata },
    chunkSize,
    retryDelays: [0, 1_000, 3_000, 5_000],
    removeFingerprintOnSuccess: true,
    ...(fingerprint ? { fingerprint } : {}),
    ...(shouldRetry
      ? {
          onShouldRetry: (error, attempt, options) =>
            shouldRetry(error.originalResponse?.getStatus()) && defaultOptions.onShouldRetry?.(error, attempt, options) === true,
        }
      : {}),
    onProgress: (sent, total) => onProgress?.({ sent, total }),
  })

  let rejectAbort!: (reason: unknown) => void
  const aborted = new Promise<never>((_resolve, reject) => (rejectAbort = reject))
  const abort = () => {
    rejectAbort(abortError())
    // Deleting on the server is best effort; the caller has already been told the upload is cancelled.
    void upload.abort(true).catch(() => undefined)
  }
  signal?.addEventListener('abort', abort, { once: true })

  const run = async () => {
    const [previous] = await upload.findPreviousUploads()
    if (signal?.aborted) throw abortError()
    if (previous) upload.resumeFromPreviousUpload(previous)
    return new Promise<string>((resolve, reject) => {
      upload.options.onError = reject
      upload.options.onSuccess = () => resolve(upload.url!)
      upload.start()
    })
  }

  try {
    return await Promise.race([run(), aborted])
  } finally {
    signal?.removeEventListener('abort', abort)
  }
}

function abortError() {
  return new DOMException('Upload cancelled', 'AbortError')
}
