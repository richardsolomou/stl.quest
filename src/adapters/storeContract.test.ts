import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AssetStore } from '../core/types'
import { LocalAssetStore } from './filesystem'
import { S3AssetStore } from './s3'
import { UploadStaging } from './staging'

type Harness = { store: AssetStore; staging: UploadStaging; cleanup: () => Promise<void> }

const MINIO_URL = process.env.MINIO_TEST_URL
const MINIO_BUCKET = 'printhub-contract-tests'

async function localHarness(): Promise<Harness> {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-contract-'))
  const data = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-contract-data-'))
  const store = new LocalAssetStore(root)
  const staging = new UploadStaging(data)
  await Promise.all([store.initialize(), staging.initialize()])
  return { store, staging, cleanup: async () => { await Promise.all([fs.promises.rm(root, { recursive: true }), fs.promises.rm(data, { recursive: true })]) } }
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
  const client = new S3Client({ endpoint: config.endpoint, region: config.region, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, forcePathStyle: true })
  await client.send(new CreateBucketCommand({ Bucket: MINIO_BUCKET })).catch((error: { name?: string }) => {
    if (error.name !== 'BucketAlreadyOwnedByYou' && error.name !== 'BucketAlreadyExists') throw error
  })
  const data = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-contract-s3-'))
  const store = new S3AssetStore(config)
  const staging = new UploadStaging(data)
  await Promise.all([store.initialize(), staging.initialize()])
  return { store, staging, cleanup: async () => { await store.sweepTrash(); await fs.promises.rm(data, { recursive: true }) } }
}

function contractSuite(name: string, harness: () => Promise<Harness>, enabled: boolean) {
  describe.skipIf(!enabled)(`AssetStore contract: ${name}`, () => {
    let store: AssetStore
    let staging: UploadStaging
    let cleanup: () => Promise<void>

    beforeEach(async () => { ({ store, staging, cleanup } = await harness()) })
    afterEach(async () => cleanup())

    it('publishes a staged upload, reads it back, and replays finalize quietly', async () => {
      const part = staging.uploadPart('contract-upload-1')
      await staging.writeUploadPart(part, new TextEncoder().encode('stl payload'))
      await store.finalizeUpload(part, 'todo/model.stl')
      expect(await store.exists('todo/model.stl')).toBe(true)
      const asset = await store.read('todo/model.stl')
      expect(asset.size).toBe(11)
      expect(Buffer.from(await new Response(asset.stream).arrayBuffer()).toString()).toBe('stl payload')
      await store.finalizeUpload(part, 'todo/model.stl')
      expect(await store.exists('todo/model.stl')).toBe(true)
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

    it('rejects traversal in keys and passes the writable probe', async () => {
      await expect(async () => store.exists('../outside')).rejects.toThrow()
      await store.writable()
    })
  })
}

contractSuite('local filesystem', localHarness, true)
contractSuite('s3-compatible', s3Harness, !!MINIO_URL)
