import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
    await Promise.all([stagingBucket, assetsBucket].map(async (bucket) => await s3.send(new CreateBucketCommand({ Bucket: bucket }))))
    Object.assign(process.env, {
      STLQUEST_DISTRIBUTED: 'true',
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
      INTEGRATIONS_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64url'),
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
})
