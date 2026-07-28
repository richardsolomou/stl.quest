import fs from 'node:fs'
import path from 'node:path'
import { Server } from '@tus/server'
import { FileStore } from '@tus/file-store'
import type { DataStore } from '@tus/server'
import { z } from 'zod'
import { app } from './app'
import { validSourceUrl } from '../core/services'
import { MAX_UPLOAD_BYTES } from '../core/uploadLimits'
import { UPLOAD_TTL } from '../adapters/tus'
import type { NewUploadedRequestInput } from '../core/services'
import { UploadRequestLimiter, validSameOrigin } from './uploadGuards'
import { hostedStorageRequiresRemote } from './storagePolicy'
import { logger } from './logger'

const WORKSPACE_METADATA_KEY = 'stlQuestWorkspaceId'
const uploadRequests = new UploadRequestLimiter()
type UploadContext = Awaited<ReturnType<Awaited<ReturnType<typeof app>>['workspace']>>
const requestContexts = new WeakMap<object, UploadContext>()
type AppInstance = Awaited<ReturnType<typeof app>>
const servers = new WeakMap<object, Map<string, Server>>()

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
  notes: optionalMetadataString(2000),
  sourceUrl: optionalMetadataString(500).refine((value) => !value || validSourceUrl(value), 'source URL must be an http(s) link'),
  requestedPrintType: z.enum(['resin', 'filament']),
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

function contextFor(request: object) {
  const context = requestContexts.get(request)
  if (!context) throw tusError(new Response('unauthenticated', { status: 401, statusText: 'unauthenticated' }))
  return context
}

async function finalizeUpload(
  uploadId: string,
  metadata: Record<string, string | null> | undefined,
  sourcePath: string,
  context: UploadContext,
) {
  const completed = await context.repository.getCompletedUpload(uploadId, context.identity.id)
  if (completed) return completed
  const parsed = metadataSchema.parse(metadata ?? {})
  const request: NewUploadedRequestInput = {
    name: parsed.name,
    fileName: parsed.filename,
    quantity: parsed.quantity,
    notes: parsed.notes || undefined,
    sourceUrl: parsed.sourceUrl || undefined,
    requestedPrintType: parsed.requestedPrintType,
  }
  const instance = await app()
  const part = instance.staging.uploadPart(uploadId)
  if ((await instance.staging.size(part)) === 0) await instance.staging.adoptUpload(sourcePath, part)
  const requestId = await context.service.createUploadedRequest(uploadId, part, request, context.identity)
  await context.assetQueue.enqueue(requestId)
  logger.info(
    {
      event: 'upload_finalized',
      outcome: 'success',
      upload_id: uploadId,
      request_id: requestId,
      workspace_id: context.workspace.id,
      posthogDistinctId: context.identity.id,
      printType: request.requestedPrintType,
    },
    'upload finalized',
  )
  return requestId
}

function serverFor(instance: AppInstance, workspaceId: string) {
  let runtimeServers = servers.get(instance.uploadDatastore)
  if (!runtimeServers) {
    runtimeServers = new Map()
    servers.set(instance.uploadDatastore, runtimeServers)
  }
  const current = runtimeServers.get(workspaceId)
  if (current) return current
  const store = instance.uploadDatastore
  const server = new Server({
    path: '/api/upload',
    datastore: store,
    locker: instance.uploadLocker,
    maxSize: MAX_UPLOAD_BYTES,
    relativeLocation: true,
    namingFunction: () => crypto.randomUUID(),
    onIncomingRequest: async (request, uploadId) => {
      try {
        const context = contextFor(request)
        if (request.method !== 'POST') {
          const upload = await store.getUpload(uploadId).catch(() => undefined)
          if (uploadWorkspaceId(upload?.metadata) !== context.workspace.id) {
            throw new Response('upload belongs to another workspace', { status: 409, statusText: 'workspace changed' })
          }
          await context.repository.createUploadSession(uploadId, context.identity.id, Date.now() + UPLOAD_TTL, 3)
          if (upload?.size !== undefined && upload.offset === upload.size && upload.storage?.path) {
            await finalizeUpload(upload.id, upload.metadata, upload.storage.path, context)
          }
        }
      } catch (error) {
        throw tusError(error)
      }
    },
    onUploadCreate: async (request, upload) => {
      try {
        const context = contextFor(request)
        metadataSchema.parse(upload.metadata ?? {})
        await instance.staging.assertCapacity(upload.size ?? 0)
        await context.repository.createUploadSession(upload.id, context.identity.id, Date.now() + UPLOAD_TTL, 3)
        if (
          !(await context.repository.reserveUpload(upload.id, context.identity.id, upload.size ?? 0, Date.now() + UPLOAD_TTL, {
            count: 3,
            bytes: MAX_UPLOAD_BYTES,
          }))
        ) {
          throw new Response('too many incomplete uploads', { status: 429, statusText: 'too many incomplete uploads' })
        }
        return { metadata: { ...upload.metadata, [WORKSPACE_METADATA_KEY]: context.workspace.id } }
      } catch (error) {
        throw tusError(error)
      }
    },
    onUploadFinish: async (request, upload) => {
      try {
        const context = contextFor(request)
        if (uploadWorkspaceId(upload.metadata) !== context.workspace.id) {
          throw new Response('upload belongs to another workspace', { status: 409, statusText: 'workspace changed' })
        }
        if (!upload.storage?.path) throw new Error('completed upload has no staged file')
        const requestId = await finalizeUpload(upload.id, upload.metadata, upload.storage.path, context)
        return { headers: { 'X-Request-Id': requestId } }
      } catch (error) {
        throw tusError(error)
      }
    },
  })
  runtimeServers.set(workspaceId, server)
  return server
}

function uploadWorkspaceId(metadata: Record<string, string | null> | undefined) {
  return metadata?.[WORKSPACE_METADATA_KEY]
}

export async function handleUpload(request: Request) {
  if (!validSameOrigin(request)) return Response.json({ error: 'cross-origin upload rejected' }, { status: 403 })
  const instance = await app()
  const context = await instance.workspace(request.headers)
  if (await hostedStorageRequiresRemote(context.storage, context.repository))
    return Response.json({ error: 'an admin must configure cloud or S3-compatible storage before uploads are allowed' }, { status: 503 })
  if (!context.storageReady)
    return Response.json({ error: 'storage is not ready — an admin needs to fix Settings → Storage first' }, { status: 503 })
  if (await context.storageMigration.active())
    return Response.json({ error: 'storage migration is in progress — uploads are temporarily paused' }, { status: 423 })
  const release = uploadRequests.enter(`${context.workspace.id}:${context.identity.id}`)
  if (!release) return Response.json({ error: 'too many concurrent upload requests' }, { status: 429 })
  requestContexts.set(request, context)
  try {
    return await serverFor(instance, context.workspace.id).handleWeb(request)
  } finally {
    requestContexts.delete(request)
    release()
  }
}

export async function cleanExpiredTusUploads(store: DataStore) {
  if (!(store instanceof FileStore)) return 0
  await fs.promises.mkdir(store.directory, { recursive: true })
  const removedIncomplete = await new Server({ path: '/api/upload', datastore: store }).cleanUpExpiredUploads()
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
