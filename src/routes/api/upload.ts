import path from 'node:path'
import { createFileRoute } from '@tanstack/react-router'
import { app, resolveBoardConfig } from '../../server/app'
import { validSourceUrl } from '../../core/services'
import { acceptUploadChunk, contentLengthAllowed, UploadLockRegistry, UploadRequestLimiter, validSameOrigin } from '../../server/uploadGuards'

// Cloudflare's proxy caps request bodies at 100 MB, so files arrive as
// sequential chunks appended to a .part file; the final request carries the
// request metadata and assembles the STL.
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024
const MAX_CHUNK_BYTES = 64 * 1024 * 1024
const MAX_THUMBNAIL_CHARS = 300_000
const MAX_REQUEST_BYTES = MAX_CHUNK_BYTES + 10 * 1024 * 1024
const uploadLocks = new UploadLockRegistry()
const uploadRequests = new UploadRequestLimiter()

function bad(message: string, status = 400): Response {
  return Response.json({ error: message }, { status })
}

export const Route = createFileRoute('/api/upload')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!validSameOrigin(request)) return bad('cross-origin upload rejected', 403)
        if (!contentLengthAllowed(request, MAX_REQUEST_BYTES)) return bad('a valid Content-Length is required and must be within the request limit', 413)
        const instance = await app()
        const identity = await instance.requireIdentity(request.headers)
        uploadLocks.expire()
        for (const expired of instance.repository.expireUploads(Date.now())) {
          await Promise.allSettled([
            instance.staging.remove(instance.staging.uploadPart(expired)),
            instance.staging.remove(instance.staging.uploadPreviewPart(expired)),
          ])
        }
        const releaseRequest = uploadRequests.enter(identity.id)
        if (!releaseRequest) return bad('too many concurrent upload requests', 429)
        let form: FormData
        try { form = await request.formData() } catch (error) { releaseRequest(); throw error }
        const reject = (message: string, status = 400) => { releaseRequest(); return bad(message, status) }

        const uploadId = String(form.get('uploadId') ?? '')
        if (!/^[a-z0-9-]{10,64}$/i.test(uploadId)) return reject('invalid upload id')
        const offset = Number(form.get('offset'))
        if (!Number.isInteger(offset) || offset < 0) return reject('invalid offset')
        const statusOnly = form.get('status') === '1'
        const chunk = form.get('chunk')
        if (statusOnly) {
          try {
            const session = instance.repository.createUploadSession(uploadId, identity.id, Date.now() + 86_400_000, 3)
            if (session.completedRequestId) return Response.json({ id: session.completedRequestId, completed: true })
            const acceptedOffset = await instance.staging.size(instance.staging.uploadPart(uploadId))
            return Response.json({ acceptedOffset })
          } finally {
            releaseRequest()
          }
        }
        if (!(chunk instanceof File) || chunk.size === 0) return reject('missing chunk')
        if (chunk.size > MAX_CHUNK_BYTES) return reject('chunk too large')
        if (offset + chunk.size > MAX_TOTAL_BYTES) return reject('file is too large (max 1 GB)')
        const previewEntry = form.get('preview')
        if (previewEntry instanceof File && chunk.size + previewEntry.size + MAX_THUMBNAIL_CHARS > MAX_REQUEST_BYTES) return reject('request body is too large', 413)

        const acquired = await uploadLocks.acquire(uploadId, identity.id)
        if (!acquired) return reject('upload id belongs to another user', 409)
        const finishing = form.get('final') === '1'
        let completed = false

        try {
          const session = instance.repository.createUploadSession(uploadId, identity.id, Date.now() + 86_400_000, 3)
          if (session.completedRequestId) {
            completed = true
            return Response.json({ id: session.completedRequestId })
          }
          const part = instance.staging.uploadPart(uploadId)
          if (offset === 0 && session.fresh) {
            await instance.staging.remove(part)
          }
          const chunkBytes = Buffer.from(await chunk.arrayBuffer())
          if (!instance.repository.reserveUpload(uploadId, identity.id, offset + chunk.size, Date.now() + 86_400_000, { count: 3, bytes: MAX_TOTAL_BYTES })) {
            return bad('too many incomplete uploads', 429)
          }

          const fileName = finishing ? path.basename(String(form.get('fileName') ?? '')) : ''
          if (finishing && !/\.stl$/i.test(fileName)) return bad('only .stl files are accepted')
          const name = finishing ? String(form.get('name') ?? '').trim().slice(0, 120) : ''
          if (finishing && !name) return bad('missing name')
          const quantity = finishing ? Number(form.get('quantity')) : 1
          if (finishing && (!Number.isInteger(quantity) || quantity < 1 || quantity > 50)) return bad('quantity must be between 1 and 50')
          const sourceUrl = finishing ? String(form.get('sourceUrl') ?? '').trim() || undefined : undefined
          if (sourceUrl && !validSourceUrl(sourceUrl)) return bad('source URL must be an http(s) link')

          try { await acceptUploadChunk(part, offset, chunkBytes) } catch (error) {
            if (error instanceof Response) return bad(await error.text(), error.status)
            throw error
          }

          if (!finishing) return Response.json({ acceptedOffset: offset + chunk.size })

          // With private requests, everyone submits as themselves.
          const requesterChoice = !resolveBoardConfig(instance.repository).privateRequests
          const requesterName =
            (requesterChoice ? String(form.get('requesterName') ?? '').trim().slice(0, 60) : '') ||
            identity.name ||
            undefined
          const notes = String(form.get('notes') ?? '').trim().slice(0, 2000) || undefined

          const thumbnailRaw = String(form.get('thumbnail') ?? '')
          const thumbnailMatch = thumbnailRaw.length <= MAX_THUMBNAIL_CHARS
            ? /^data:(image\/(?:png|webp|jpeg));base64,(.+)$/.exec(thumbnailRaw)
            : null
          const thumbnail = thumbnailMatch
            ? { bytes: new Uint8Array(Buffer.from(thumbnailMatch[2], 'base64')), mime: thumbnailMatch[1] }
            : undefined

          const preview = previewEntry
          const previewBytes = preview instanceof File && preview.size > 0 && preview.size <= MAX_CHUNK_BYTES
            ? new Uint8Array(await preview.arrayBuffer())
            : undefined

          const id = await instance.service.createUploadedRequest(uploadId, part, {
            name,
            fileName,
            quantity,
            requesterEmail: identity.email,
            requesterName,
            notes,
            sourceUrl,
          }, identity, previewBytes, thumbnail)
          completed = true
          return Response.json({ id })
        } finally {
          acquired.release(completed)
          releaseRequest()
        }
      },
    },
  },
})
