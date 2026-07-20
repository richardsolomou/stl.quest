import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertStorageAllowed, hostedStorageRequiresRemote, localStorageAllowed, storageConfigured } from './storagePolicy'

describe('hosted storage policy', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('requires remote storage for hosted deployments', () => {
    vi.stubEnv('PRINTHUB_HOSTED', 'true')

    expect(hostedStorageRequiresRemote({ adapter: 'local', root: '/prints' }, { isSuperAdminWorkspace: () => false })).toBe(true)
  })

  it('allows local storage for super admin workspaces', () => {
    vi.stubEnv('PRINTHUB_HOSTED', 'true')

    expect(localStorageAllowed({ isSuperAdminWorkspace: () => true })).toBe(true)
  })

  it('allows S3-compatible storage for hosted deployments', () => {
    vi.stubEnv('PRINTHUB_HOSTED', 'true')

    expect(() =>
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
        { isSuperAdminWorkspace: () => false },
      ),
    ).not.toThrow()
  })

  it('requires HTTPS for hosted WebDAV storage', () => {
    vi.stubEnv('PRINTHUB_HOSTED', 'true')

    let rejection: unknown
    try {
      assertStorageAllowed(
        { adapter: 'webdav', endpoint: 'http://storage.example.com', root: 'printhub', username: 'user', password: 'secret' },
        { isSuperAdminWorkspace: () => false },
      )
    } catch (error) {
      rejection = error
    }

    expect(rejection).toMatchObject({ status: 400 })
  })

  it('rejects local storage for hosted deployments', () => {
    vi.stubEnv('PRINTHUB_HOSTED', 'true')
    let rejection: unknown

    try {
      assertStorageAllowed({ adapter: 'local', root: '/prints' }, { isSuperAdminWorkspace: () => false })
    } catch (error) {
      rejection = error
    }

    expect(rejection).toMatchObject({ status: 403 })
  })

  it('detects encrypted storage settings', () => {
    const encrypted = { getSetting: (key: string) => (key === 'storageEncrypted' ? { ciphertext: 'value' } : undefined) }

    expect(storageConfigured(encrypted)).toBe(true)
  })

  it('detects legacy storage settings', () => {
    const legacy = { getSetting: (key: string) => (key === 'storage' ? { adapter: 'local' } : undefined) }

    expect(storageConfigured(legacy)).toBe(true)
  })
})
