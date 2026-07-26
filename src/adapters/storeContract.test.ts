import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { createClient } from 'webdav'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AssetStore } from '../core/types'
import { LocalAssetStore } from './filesystem'
import { S3AssetStore } from './s3'
import { WebDAVAssetStore } from './webdav'
import { UploadStaging } from './staging'

type Harness = { store: AssetStore; staging: UploadStaging; cleanup: () => Promise<void> }

const MINIO_URL = process.env.MINIO_TEST_URL
const MINIO_BUCKET = 'stlquest-contract-tests'
const WEBDAV_URL = process.env.WEBDAV_TEST_URL

async function localHarness(): Promise<Harness> {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-contract-'))
  const data = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-contract-data-'))
  const store = new LocalAssetStore(root)
  const staging = new UploadStaging(data)
  await Promise.all([store.initialize(), staging.initialize()])
  return {
    store,
    staging,
    cleanup: async () => {
      await Promise.all([fs.promises.rm(root, { recursive: true }), fs.promises.rm(data, { recursive: true })])
    },
  }
}

async function s3Harness(): Promise<Harness> {
  const config = {
    adapter: 's3' as const,
    endpoint: MINIO_URL!,
    region: 'us-east-1',
    bucket: MINIO_BUCKET,
    prefix: crypto.randomUUID(),
    accessKeyId: process.env.MINIO_TEST_ACCESS_KEY ?? 'minioadmin',
    secretAccessKey: process.env.MINIO_TEST_SECRET_KEY ?? 'minioadmin',
    forcePathStyle: true,
  }
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    forcePathStyle: true,
  })
  await client.send(new CreateBucketCommand({ Bucket: MINIO_BUCKET })).catch((error: { name?: string }) => {
    if (error.name !== 'BucketAlreadyOwnedByYou' && error.name !== 'BucketAlreadyExists') throw error
  })
  const data = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-contract-s3-'))
  const store = new S3AssetStore(config)
  const staging = new UploadStaging(data)
  await Promise.all([store.initialize(), staging.initialize()])
  return {
    store,
    staging,
    cleanup: async () => {
      await store.sweepTrash()
      await fs.promises.rm(data, { recursive: true })
    },
  }
}

async function webDAVHarness(): Promise<Harness> {
  const root = `stlquest-contract-${crypto.randomUUID()}`
  const username = process.env.WEBDAV_TEST_USERNAME ?? 'stlquest'
  const password = process.env.WEBDAV_TEST_PASSWORD ?? 'stlquest'
  const config = { adapter: 'webdav' as const, endpoint: WEBDAV_URL!, root, username, password }
  const client = createClient(config.endpoint, { username, password })
  const data = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-contract-webdav-'))
  const store = new WebDAVAssetStore(config)
  const staging = new UploadStaging(data)
  await Promise.all([store.initialize(), staging.initialize()])
  return {
    store,
    staging,
    cleanup: async () => {
      await client.deleteFile(`/${root}`).catch((error: { status?: number }) => {
        if (error.status !== 404) throw error
      })
      await fs.promises.rm(data, { recursive: true })
    },
  }
}

function contractSuite(name: string, harness: () => Promise<Harness>, enabled: boolean) {
  describe.skipIf(!enabled)(`AssetStore contract: ${name}`, () => {
    let store: AssetStore
    let staging: UploadStaging
    let cleanup: () => Promise<void>

    beforeEach(async () => {
      ;({ store, staging, cleanup } = await harness())
    })
    afterEach(async () => cleanup?.())

    it('publishes a staged upload, reads it back, and replays finalize quietly', async () => {
      const part = staging.uploadPart('contract-upload-1')
      const modelPath = store.createPath('00000000-0000-4000-8000-000000000001', 'model.stl')
      await staging.writeUploadPart(part, new TextEncoder().encode('stl payload'))
      await store.finalizeUpload(part, modelPath)
      expect(await store.exists(modelPath)).toBe(true)
      const asset = await store.read(modelPath)
      expect(asset.size).toBe(11)
      expect(Buffer.from(await new Response(asset.stream).arrayBuffer()).toString()).toBe('stl payload')
      await store.finalizeUpload(part, modelPath)
      expect(await store.exists(modelPath)).toBe(true)
    })

    it('honors the ensureMoved truth table', async () => {
      await store.write('todo/move.stl', new TextEncoder().encode('bytes'))
      await store.ensureMoved('todo/move.stl', 'done/move.stl')
      expect(await store.exists('todo/move.stl')).toBe(false)
      expect(await store.exists('done/move.stl')).toBe(true)
      await store.ensureMoved('todo/move.stl', 'done/move.stl')
      expect(await store.exists('done/move.stl')).toBe(true)
      await expect(store.ensureMoved('todo/never-was.stl', 'done/never-was.stl')).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('trashes deterministically and purges idempotently', async () => {
      await store.write('todo/gone.stl', new TextEncoder().encode('bytes'))
      const operationId = crypto.randomUUID()
      const trashPath = store.trashPath(operationId, 'todo/gone.stl')
      expect(store.trashPath(operationId, 'todo/gone.stl')).toBe(trashPath)
      await store.ensureMoved('todo/gone.stl', trashPath)
      expect(await store.exists(trashPath)).toBe(true)
      await store.purgeTrash(trashPath)
      await store.purgeTrash(trashPath)
      expect(await store.exists(trashPath)).toBe(false)
    })

    it('removes only empty legacy directories and does so idempotently', async () => {
      await store.write('todo/orphaned.stl', new TextEncoder().encode('bytes'))
      expect(await store.removeEmptyDirectory('todo')).toBe(false)
      expect(await store.exists('todo/orphaned.stl')).toBe(true)
      await store.remove('todo/orphaned.stl')
      expect(await store.removeEmptyDirectory('todo')).toBe(true)
      expect(await store.removeEmptyDirectory('todo')).toBe(true)
    })

    it('rejects traversal in keys and passes the writable probe', async () => {
      await expect(async () => store.exists('../outside')).rejects.toThrow()
      await store.writable()
    })

    it('inventories and clears only the configured storage namespace', async () => {
      await store.write('existing/first.stl', new TextEncoder().encode('first'))
      await store.write('existing/nested/second.stl', new TextEncoder().encode('second'))

      expect(await store.inventory()).toEqual({ files: 2, folders: expect.any(Number), bytes: 11 })
      await store.clear()

      expect(await store.inventory()).toEqual({ files: 0, folders: 0, bytes: 0 })
      await store.writable()
    })
  })
}

contractSuite('local filesystem', localHarness, true)
contractSuite('s3-compatible', s3Harness, !!MINIO_URL)
contractSuite('webdav', webDAVHarness, !!WEBDAV_URL)
