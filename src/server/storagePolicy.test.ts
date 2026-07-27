import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertStorageAllowed, localStorageEnabled, storageConfigured } from './storagePolicy'

describe('hosted storage policy', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('disables local storage by default for hosted deployments', async () => {
    vi.stubEnv('STLQUEST_HOSTED', 'true')

    expect(await localStorageEnabled({ getDeploymentSetting: async () => undefined })).toBe(false)
  })

  it('allows super admins to enable local storage for every workspace', async () => {
    vi.stubEnv('STLQUEST_HOSTED', 'true')

    expect(await localStorageEnabled({ getDeploymentSetting: async () => true })).toBe(true)
  })

  it('enables local storage by default for self-hosted deployments', async () => {
    expect(await localStorageEnabled({ getDeploymentSetting: async () => undefined })).toBe(true)
  })

  it('allows S3-compatible storage for hosted deployments', async () => {
    vi.stubEnv('STLQUEST_HOSTED', 'true')

    await expect(
      assertStorageAllowed(
        {
          adapter: 's3',
          endpoint: 'https://s3.example.com',
          region: 'us-east-1',
          bucket: 'prints',
          accessKeyId: 'key',
          secretAccessKey: 'secret',
          forcePathStyle: false,
        },
        { getDeploymentSetting: async () => false },
      ),
    ).resolves.toBeUndefined()
  })

  it('requires HTTPS for hosted WebDAV storage', async () => {
    vi.stubEnv('STLQUEST_HOSTED', 'true')

    await expect(
      assertStorageAllowed(
        { adapter: 'webdav', endpoint: 'http://storage.example.com', root: 'stlquest', username: 'user', password: 'secret' },
        { getDeploymentSetting: async () => false },
      ),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects local storage for hosted deployments', async () => {
    vi.stubEnv('STLQUEST_HOSTED', 'true')
    await expect(
      assertStorageAllowed({ adapter: 'local', root: '/prints' }, { getDeploymentSetting: async () => false }),
    ).rejects.toMatchObject({
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
