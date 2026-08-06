import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3'
import postgres from 'postgres'
import { Worker } from 'node:worker_threads'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { exportBinaryStl } from '../core/mesh/stl'

const endpoint = process.env.DISTRIBUTED_TEST_S3_ENDPOINT
const redisUrl = process.env.DISTRIBUTED_TEST_REDIS_URL
const databaseUrl = process.env.DISTRIBUTED_TEST_POSTGRES_URL
const describeDistributed = endpoint && redisUrl && databaseUrl ? describe : describe.skip

function cookies(headers: Headers) {
  return headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')
}

function metadata(values: Record<string, string>) {
  return Object.entries(values)
    .map(([key, value]) => `${key} ${Buffer.from(value).toString('base64')}`)
    .join(',')
}

describeDistributed('distributed upload application flow', () => {
  const stagingBucket = `staging-${crypto.randomUUID()}`
  const assetsBucket = `assets-${crypto.randomUUID()}`
  const managedBucket = `managed-${crypto.randomUUID()}`
  const accessKeyId = process.env.DISTRIBUTED_TEST_S3_ACCESS_KEY_ID!
  const secretAccessKey = process.env.DISTRIBUTED_TEST_S3_SECRET_ACCESS_KEY!

  beforeAll(async () => {
    const database = postgres(databaseUrl!, { max: 1 })
    await database`DROP SCHEMA public CASCADE`
    await database`DROP SCHEMA IF EXISTS drizzle CASCADE`
    await database`CREATE SCHEMA public`
    await database.end()
    const s3 = new S3Client({
      endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    })
    await Promise.all(
      [stagingBucket, assetsBucket, managedBucket].map(async (bucket) => await s3.send(new CreateBucketCommand({ Bucket: bucket }))),
    )
    Object.assign(process.env, {
      STLQUEST_DISTRIBUTED: 'true',
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
      INTEGRATIONS_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64url'),
      STLQUEST_CENTRIFUGO_SECRET: 'shared-realtime-secret',
      S3_BUCKET: stagingBucket,
      S3_REGION: 'us-east-1',
      S3_ENDPOINT: endpoint,
      S3_ACCESS_KEY_ID: accessKeyId,
      S3_SECRET_ACCESS_KEY: secretAccessKey,
      S3_FORCE_PATH_STYLE: 'true',
      BETTER_AUTH_URL: 'http://print.test',
    })
  })

  afterAll(async () => {
    const { resetApp } = await import('./app')
    await resetApp()
    for (const name of [
      'STLQUEST_DISTRIBUTED',
      'DATABASE_URL',
      'REDIS_URL',
      'INTEGRATIONS_ENCRYPTION_KEY',
      'STLQUEST_CENTRIFUGO_SECRET',
      'S3_BUCKET',
      'S3_REGION',
      'S3_ENDPOINT',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
      'S3_FORCE_PATH_STYLE',
      'BETTER_AUTH_URL',
    ])
      delete process.env[name]
  }, 30_000)

  it('creates and finishes an authenticated upload across replica lifecycles', async () => {
    const { app, resetApp } = await import('./app')
    const first = await app()
    const signup = await first.auth.api.signUpEmail({
      body: { email: 'owner@example.com', password: 'password1234', name: 'Owner' },
      returnHeaders: true,
    })
    const cookie = cookies(signup.headers)
    const identity = await first.requireIdentity(new Headers({ cookie }))
    const workspace = (await first.repository.listWorkspacesForUser(identity.id))[0]
    await (
      await first.repository.scoped(workspace.id)
    ).setSetting('storage', {
      adapter: 's3',
      endpoint,
      region: 'us-east-1',
      bucket: assetsBucket,
      accessKeyId,
      secretAccessKey,
      forcePathStyle: true,
    })
    await resetApp()

    const headers = {
      cookie,
      origin: 'http://print.test',
      'sec-fetch-site': 'same-origin',
      'tus-resumable': '1.0.0',
    }
    const bytes = exportBinaryStl(new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]), new Uint32Array([0, 1, 2]))
    const { handleUpload } = await import('./uploads')
    const created = await handleUpload(
      new Request('http://print.test/api/upload', {
        method: 'POST',
        headers: {
          ...headers,
          'upload-length': String(bytes.length),
          'upload-metadata': metadata({ filename: 'probe.stl', name: 'Probe', quantity: '1', requestedPrintType: 'resin' }),
        },
      }),
    )
    const location = created.headers.get('location')
    expect(location).toBeTruthy()
    await resetApp()

    const completed = await handleUpload(
      new Request(`http://print.test${location}`, {
        method: 'PATCH',
        headers: { ...headers, 'content-type': 'application/offset+octet-stream', 'upload-offset': '0' },
        body: Buffer.from(bytes),
      }),
    )

    expect(completed.status).toBe(204)
    const second = await app()
    expect(await (await second.repository.scoped(workspace.id)).hasRequests()).toBe(true)
    await (await second.workspace(new Headers(headers))).assetQueue.idle()
  })

  it('publishes a managed upload through distributed staging and charges it once', async () => {
    const { MANAGED_STORAGE_QUOTA_BYTES } = await import('./managedStorage')
    Object.assign(process.env, {
      STLQUEST_HOSTED: 'true',
      STLQUEST_HOSTED_STORAGE_BUCKET: managedBucket,
      STLQUEST_HOSTED_STORAGE_ENDPOINT: endpoint,
      STLQUEST_HOSTED_STORAGE_REGION: 'us-east-1',
      STLQUEST_HOSTED_STORAGE_ACCESS_KEY_ID: accessKeyId,
      STLQUEST_HOSTED_STORAGE_SECRET_ACCESS_KEY: secretAccessKey,
      STLQUEST_HOSTED_STORAGE_FORCE_PATH_STYLE: 'true',
    })
    let managedWorkspaceId: string | undefined
    try {
      const { app, resetApp } = await import('./app')
      const instance = await app()
      const signup = await instance.auth.api.signUpEmail({
        body: { email: 'managed@example.com', password: 'password1234', name: 'Managed' },
        returnHeaders: true,
      })
      const cookie = cookies(signup.headers)
      const identity = await instance.requireIdentity(new Headers({ cookie }))
      const workspace = (await instance.repository.listWorkspacesForUser(identity.id))[0]
      managedWorkspaceId = workspace.id
      const scoped = await instance.repository.scoped(workspace.id)
      await scoped.claimManagedStorage(identity.id, 3)
      await scoped.setSetting('storage', { adapter: 'managed' })
      await resetApp()

      const headers = {
        cookie,
        origin: 'http://print.test',
        'sec-fetch-site': 'same-origin',
        'tus-resumable': '1.0.0',
      }
      const bytes = exportBinaryStl(new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]), new Uint32Array([0, 1, 2]))
      const { handleUpload } = await import('./uploads')
      const created = await handleUpload(
        new Request('http://print.test/api/upload', {
          method: 'POST',
          headers: {
            ...headers,
            'upload-length': String(bytes.length),
            'upload-metadata': metadata({ filename: 'managed.stl', name: 'Managed', quantity: '1', requestedPrintType: 'resin' }),
          },
        }),
      )
      const location = created.headers.get('location')
      expect(location).toBeTruthy()

      const completed = await handleUpload(
        new Request(`http://print.test${location}`, {
          method: 'PATCH',
          headers: { ...headers, 'content-type': 'application/offset+octet-stream', 'upload-offset': '0' },
          body: Buffer.from(bytes),
        }),
      )

      expect(completed.status).toBe(204)
      const after = await app()
      const settled = await after.repository.scoped(workspace.id)
      expect(await settled.hasRequests()).toBe(true)
      // Charged once: a second reservation for the same upload would leave twice the bytes withheld.
      expect(await settled.managedStorageRemaining(MANAGED_STORAGE_QUOTA_BYTES)).toBe(MANAGED_STORAGE_QUOTA_BYTES - bytes.length)
    } finally {
      // Point the workspace back at a plain bucket while managed storage is still configured;
      // otherwise later replicas cannot build a runtime for it.
      if (managedWorkspaceId) {
        const { app } = await import('./app')
        const scoped = await (await app()).repository.scoped(managedWorkspaceId)
        await scoped.setSetting('storage', {
          adapter: 's3',
          endpoint,
          region: 'us-east-1',
          bucket: assetsBucket,
          accessKeyId,
          secretAccessKey,
          forcePathStyle: true,
        })
        await scoped.releaseManagedStorage()
      }
      for (const name of [
        'STLQUEST_HOSTED',
        'STLQUEST_HOSTED_STORAGE_BUCKET',
        'STLQUEST_HOSTED_STORAGE_ENDPOINT',
        'STLQUEST_HOSTED_STORAGE_REGION',
        'STLQUEST_HOSTED_STORAGE_ACCESS_KEY_ID',
        'STLQUEST_HOSTED_STORAGE_SECRET_ACCESS_KEY',
        'STLQUEST_HOSTED_STORAGE_FORCE_PATH_STYLE',
      ])
        delete process.env[name]
      const { resetApp } = await import('./app')
      await resetApp()
    }
  }, 30_000)

  it('starts two complete replicas concurrently', async () => {
    const replicas = [
      new Worker(new URL('./distributedReplica.worker.ts', import.meta.url), { execArgv: ['--import', 'tsx'] }),
      new Worker(new URL('./distributedReplica.worker.ts', import.meta.url), { execArgv: ['--import', 'tsx'] }),
    ]
    const waitFor = (replica: Worker, expected: string) =>
      new Promise<string>((resolve, reject) => {
        replica.once('error', reject)
        replica.once('message', (message) =>
          message === expected ? resolve(message) : reject(new Error(`unexpected worker message: ${message}`)),
        )
      })
    const request = (replica: Worker, type: string, revision?: string) => {
      const id = crypto.randomUUID()
      return new Promise<unknown>((resolve, reject) => {
        const onMessage = (message: { id?: string; value?: unknown }) => {
          if (message.id !== id) return
          replica.off('message', onMessage)
          resolve(message.value)
        }
        replica.on('error', reject)
        replica.on('message', onMessage)
        replica.postMessage({ id, type, revision })
      })
    }
    try {
      expect(await Promise.all(replicas.map(async (replica) => await waitFor(replica, 'ready')))).toEqual(['ready', 'ready'])
      expect(await request(replicas[1], 'revision')).toBeUndefined()
      const revision = crypto.randomUUID()
      expect(await request(replicas[0], 'change-revision', revision)).toBe(revision)
      await vi.waitFor(async () => expect(await request(replicas[1], 'revision')).toBe(revision))
      expect(await Promise.all(replicas.map(async (replica) => await request(replica, 'close')))).toEqual(['closed', 'closed'])
    } finally {
      await Promise.all(replicas.map(async (replica) => await replica.terminate()))
    }
  }, 30_000)
})
