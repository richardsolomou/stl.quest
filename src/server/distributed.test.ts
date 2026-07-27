import { describe, expect, it } from 'vitest'
import { assertDistributedWorkspaceReadiness, resolveDistributedConfig } from './distributed'

const validEnvironment = {
  STLQUEST_DISTRIBUTED: 'true',
  DATABASE_URL: 'postgresql://postgres:postgres@database/stlquest',
  REDIS_URL: 'rediss://redis.example.com',
  INTEGRATIONS_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64url'),
  STAGING_S3_BUCKET: 'stlquest-staging',
  STAGING_S3_REGION: 'auto',
  STAGING_S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
  STAGING_S3_ACCESS_KEY_ID: 'access-key',
  STAGING_S3_SECRET_ACCESS_KEY: 'secret-key',
  STAGING_S3_FORCE_PATH_STYLE: 'true',
}

describe('distributed configuration', () => {
  it('leaves the single-instance runtime unchanged by default', () => {
    expect(resolveDistributedConfig({})).toBeUndefined()
  })

  it('resolves the shared services required by distributed mode', () => {
    expect(resolveDistributedConfig(validEnvironment)).toEqual({
      databaseUrl: validEnvironment.DATABASE_URL,
      redisUrl: validEnvironment.REDIS_URL,
      encryptionKey: validEnvironment.INTEGRATIONS_ENCRYPTION_KEY,
      staging: {
        bucket: validEnvironment.STAGING_S3_BUCKET,
        region: validEnvironment.STAGING_S3_REGION,
        endpoint: validEnvironment.STAGING_S3_ENDPOINT,
        accessKeyId: validEnvironment.STAGING_S3_ACCESS_KEY_ID,
        secretAccessKey: validEnvironment.STAGING_S3_SECRET_ACCESS_KEY,
        forcePathStyle: true,
      },
    })
  })

  it.each([
    ['DATABASE_URL', undefined, 'DATABASE_URL is required'],
    ['DATABASE_URL', 'file:local.sqlite', 'distributed mode requires a PostgreSQL DATABASE_URL'],
    ['REDIS_URL', undefined, 'REDIS_URL is required'],
    ['REDIS_URL', 'https://redis.example.com', 'REDIS_URL must use redis:// or rediss://'],
    ['INTEGRATIONS_ENCRYPTION_KEY', undefined, 'INTEGRATIONS_ENCRYPTION_KEY is required'],
    ['STAGING_S3_BUCKET', undefined, 'STAGING_S3_BUCKET is required'],
    ['STAGING_S3_REGION', undefined, 'STAGING_S3_REGION is required'],
  ])('rejects an invalid %s', (name, value, message) => {
    expect(() => resolveDistributedConfig({ ...validEnvironment, [name]: value })).toThrow(message)
  })

  it('requires S3 credentials to be configured as a pair', () => {
    expect(() => resolveDistributedConfig({ ...validEnvironment, STAGING_S3_SECRET_ACCESS_KEY: undefined })).toThrow(
      'STAGING_S3_ACCESS_KEY_ID and STAGING_S3_SECRET_ACCESS_KEY must be configured together',
    )
  })
})

describe('distributed workspace readiness', () => {
  const ready = { slug: 'ready', localStorageInUse: false, activeUploads: 0, storageMigrationRunning: false }

  it('accepts drained workspaces using remote storage', () => {
    expect(() => assertDistributedWorkspaceReadiness([ready])).not.toThrow()
  })

  it.each([
    [{ ...ready, localStorageInUse: true }, 'distributed mode requires remote storage'],
    [{ ...ready, storageMigrationRunning: true }, 'finish storage migrations'],
    [{ ...ready, activeUploads: 1 }, 'finish or cancel active uploads'],
  ])('rejects a workspace that is not ready', (workspace, message) => {
    expect(() => assertDistributedWorkspaceReadiness([workspace])).toThrow(message)
  })
})
