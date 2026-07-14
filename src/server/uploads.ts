import fs from 'node:fs'
import path from 'node:path'
import { FileStore } from '@tus/file-store'
import { Server } from '@tus/server'
import { z } from 'zod'
import { app, resolveBoardConfig } from './app'
import { validSourceUrl } from '../core/services'
import type { Identity, NewPrintRequest } from '../core/types'
import { UploadRequestLimiter, validSameOrigin } from './uploadGuards'
import { uploadBytes, uploadsCompleted } from './metrics'
import { assertUploadCapacity } from './operations'

const MAX_TOTAL_BYTES = 1024 * 1024 * 1024
const UPLOAD_TTL = 86_400_000
const uploadRequests = new UploadRequestLimiter()
const requestIdentities = new WeakMap<object, Identity>()
const store = new FileStore({
  directory: path.join(path.resolve(process.env.DATA_DIR ?? '/data'), 'tus'),
  expirationPeriodInMilliseconds: UPLOAD_TTL,
})

const optionalMetadataString = (max: number) =>
  z.preprocess((value) => (value === null ? undefined : value), z.string().trim().max(max).optional())

const metadataSchema = z.object({
  filename: z
    .string()
    .max(255)
    .transform((value) => path.basename(value))
    .refine((value) => /\.stl$/i.test(value), 'only .stl files are accepted'),
  name: z.string().trim().min(1).max(120),
  quantity: z.coerce.number().int().min(1).max(50),
  requesterName: optionalMetadataString(60),
  notes: optionalMetadataString(2000),
  sourceUrl: optionalMetadataString(500).refine((value) => !value || validSourceUrl(value), 'source URL must be an http(s) link'),
  printerId: optionalMetadataString(100),
})

function tusError(error: unknown): Error & { status_code: number; body: string } {
  if (error instanceof Response) {
    const wrapped = new Error(error.statusText || 'upload rejected') as Error & { status_code: number; body: string }
    wrapped.status_code = error.status
    wrapped.body = error.statusText || 'upload rejected'
    return wrapped
  }
  if (error instanceof z.ZodError) {
    const wrapped = new Error(error.issues[0]?.message ?? 'invalid upload metadata') as Error & { status_code: number; body: string }
    wrapped.status_code = 400
    wrapped.body = wrapped.message
    return wrapped
  }
  const wrapped = (error instanceof Error ? error : new Error(String(error))) as Error & { status_code: number; body: string }
  wrapped.status_code ||= 500
  wrapped.body ||= wrapped.message
  return wrapped
}

function identityFor(request: object) {
  const identity = requestIdentities.get(request)
  if (!identity) throw tusError(new Response('unauthenticated', { status: 401, statusText: 'unauthenticated' }))
  return identity
}

async function finalizeUpload(
  uploadId: string,
  metadata: Record<string, string | null> | undefined,
  sourcePath: string,
  identity: Identity,
) {
  const instance = await app()
  const completed = instance.repository.getCompletedUpload(uploadId, identity.id)
  if (completed) return completed
  const parsed = metadataSchema.parse(metadata ?? {})
  const printers = instance.repository.getSetting<import('../core/platePlanner').PrinterProfile[]>('plate-planner-profiles') ?? []
  if (parsed.printerId && !printers.some((printer) => printer.id === parsed.printerId)) {
    throw new Response('unknown printer', { status: 400, statusText: 'unknown printer' })
  }
  const requesterChoice = !resolveBoardConfig(instance.repository).privateRequests
  const request: Omit<NewPrintRequest, 'filePath' | 'previewPath' | 'thumbnailPath'> = {
    name: parsed.name,
    fileName: parsed.filename,
    quantity: parsed.quantity,
    requesterEmail: identity.email,
    requesterName: (requesterChoice ? parsed.requesterName : '') || identity.name || undefined,
    notes: parsed.notes || undefined,
    sourceUrl: parsed.sourceUrl || undefined,
    printerId: parsed.printerId,
  }
  const part = instance.staging.uploadPart(uploadId)
  if ((await instance.staging.size(part)) === 0) await instance.staging.copyUploadPart(sourcePath, part)
  const completedBytes = await instance.staging.size(part)
  const requestId = await instance.service.createUploadedRequest(uploadId, part, request, identity)
  instance.assetQueue.enqueue(requestId)
  uploadsCompleted.inc()
  uploadBytes.inc(completedBytes)
  return requestId
}

const server = new Server({
  path: '/api/upload',
  datastore: store,
  maxSize: MAX_TOTAL_BYTES,
  relativeLocation: true,
  namingFunction: () => crypto.randomUUID(),
  onIncomingRequest: async (request, uploadId) => {
    try {
      const identity = identityFor(request)
      const instance = await app()
      if (request.method !== 'POST') {
        instance.repository.createUploadSession(uploadId, identity.id, Date.now() + UPLOAD_TTL, 3)
        const upload = await store.getUpload(uploadId).catch(() => undefined)
        if (upload?.size !== undefined && upload.offset === upload.size && upload.storage?.path) {
          await finalizeUpload(upload.id, upload.metadata, upload.storage.path, identity)
        }
      }
    } catch (error) {
      throw tusError(error)
    }
  },
  onUploadCreate: async (request, upload) => {
    try {
      const identity = identityFor(request)
      const instance = await app()
      metadataSchema.parse(upload.metadata ?? {})
      await assertUploadCapacity(instance.staging.root, upload.size ?? 0)
      instance.repository.createUploadSession(upload.id, identity.id, Date.now() + UPLOAD_TTL, 3)
      if (
        !instance.repository.reserveUpload(upload.id, identity.id, upload.size ?? 0, Date.now() + UPLOAD_TTL, {
          count: 3,
          bytes: MAX_TOTAL_BYTES,
        })
      ) {
        throw new Response('too many incomplete uploads', { status: 429, statusText: 'too many incomplete uploads' })
      }
      return { metadata: upload.metadata }
    } catch (error) {
      throw tusError(error)
    }
  },
  onUploadFinish: async (request, upload) => {
    try {
      const identity = identityFor(request)
      if (!upload.storage?.path) throw new Error('completed upload has no staged file')
      const requestId = await finalizeUpload(upload.id, upload.metadata, upload.storage.path, identity)
      return { headers: { 'X-Request-Id': requestId } }
    } catch (error) {
      throw tusError(error)
    }
  },
})

export async function handleUpload(request: Request) {
  if (!validSameOrigin(request)) return Response.json({ error: 'cross-origin upload rejected' }, { status: 403 })
  const instance = await app()
  if (!instance.storageReady)
    return Response.json({ error: 'storage is not ready — an admin needs to fix Settings → Storage first' }, { status: 503 })
  const identity = await instance.requireIdentity(request.headers)
  const release = uploadRequests.enter(identity.id)
  if (!release) return Response.json({ error: 'too many concurrent upload requests' }, { status: 429 })
  requestIdentities.set(request, identity)
  try {
    return await server.handleWeb(request)
  } finally {
    requestIdentities.delete(request)
    release()
  }
}

export async function cleanExpiredTusUploads() {
  await fs.promises.mkdir(store.directory, { recursive: true })
  const removedIncomplete = await server.cleanUpExpiredUploads()
  const now = Date.now()
  let removedCompleted = 0
  for (const uploadId of (await store.configstore.list?.()) ?? []) {
    const upload = await store.configstore.get(uploadId)
    if (!upload?.creation_date || now - new Date(upload.creation_date).getTime() <= UPLOAD_TTL) continue
    await store.remove(uploadId).catch(() => undefined)
    removedCompleted++
  }
  return removedIncomplete + removedCompleted
}
