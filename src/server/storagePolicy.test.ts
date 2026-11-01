import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertStorageAllowed, localStorageEnabled, storageConfigured } from './storagePolicy'

describe('hosted storage policy', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('disables local storage for hosted deployments', () => {
    vi.stubEnv('STLQUEST_HOSTED', 'true')

    expect(localStorageEnabled()).toBe(false)
  })

  it('enables local storage for self-hosted single-replica deployments', () => {
    expect(localStorageEnabled()).toBe(true)
  })

  it('disables local storage in distributed mode', () => {
    vi.stubEnv('STLQUEST_DISTRIBUTED', 'true')

    expect(localStorageEnabled()).toBe(false)
  })

  it('allows S3-compatible storage for hosted deployments', async () => {
    vi.stubEnv('STLQUEST_HOSTED', 'true')

    await expect(
      assertStorageAllowed({
        adapter: 's3',
        endpoint: 'https://s3.example.com',
        region: 'us-east-1',
        bucket: 'prints',
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        forcePathStyle: false,
      }),
    ).resolves.toBeUndefined()
  })

  it('requires HTTPS for hosted WebDAV storage', async () => {
    vi.stubEnv('STLQUEST_HOSTED', 'true')

    await expect(
      assertStorageAllowed({
        adapter: 'webdav',
        endpoint: 'http://storage.example.com',
        root: 'stlquest',
        username: 'user',
        password: 'secret',
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects hosted S3 storage at a private address', async () => {
    vi.stubEnv('STLQUEST_HOSTED', 'true')

    await expect(
      assertStorageAllowed({
        adapter: 's3',
        endpoint: 'http://169.254.169.254',
        region: 'us-east-1',
        bucket: 'prints',
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        forcePathStyle: true,
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects hosted WebDAV storage on localhost', async () => {
    vi.stubEnv('STLQUEST_HOSTED', 'true')

    await expect(
      assertStorageAllowed({
        adapter: 'webdav',
        endpoint: 'https://localhost/dav',
        root: 'stlquest',
        username: 'user',
        password: 'secret',
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('allows self-hosted storage on the local network', async () => {
    await expect(
      assertStorageAllowed({
        adapter: 'webdav',
        endpoint: 'http://192.168.1.20/dav',
        root: 'stlquest',
        username: 'user',
        password: 'secret',
      }),
    ).resolves.toBeUndefined()
  })

  it('rejects local storage for hosted deployments', async () => {
    vi.stubEnv('STLQUEST_HOSTED', 'true')
    await expect(assertStorageAllowed({ adapter: 'local', root: '/prints' })).rejects.toMatchObject({
      status: 403,
    })
  })

  it('detects encrypted storage settings', async () => {
    const encrypted = { getSetting: async (key: string) => (key === 'storageEncrypted' ? { ciphertext: 'value' } : undefined) }

    expect(await storageConfigured(encrypted)).toBe(true)
  })

  it('detects storage migration settings', async () => {
    const migrating = { getSetting: async (key: string) => (key === 'storage' ? { adapter: 'local' } : undefined) }

    expect(await storageConfigured(migrating)).toBe(true)
  })
})
