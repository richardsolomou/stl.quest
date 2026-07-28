import { describe, expect, it, vi } from 'vitest'
import type { StorageConfig } from '../core/types'
import { storageChangeRequiresMigration, captureRouteError, storageConfigChanged } from './fns'

describe('route errors', () => {
  it('reports the original browser error through server telemetry', async () => {
    const exception = vi.fn(async () => undefined)

    await captureRouteError(
      { exception },
      { name: 'TypeError', message: 'workspace failed', stack: 'TypeError: workspace failed\n    at route.tsx:1:1' },
    )

    expect(exception).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'TypeError', message: 'workspace failed', stack: expect.stringContaining('route.tsx:1:1') }),
      { action: 'route_error' },
    )
  })
})

describe('storage settings', () => {
  it('allows persisting the active fallback storage configuration', () => {
    expect(storageConfigChanged({ adapter: 'local', root: '/prints' }, { adapter: 'local', root: '/prints' })).toBe(false)
  })

  it('requires an empty board when the storage configuration changes', () => {
    expect(storageConfigChanged({ adapter: 'local', root: '/prints' }, { adapter: 'local', root: '/other' })).toBe(true)
  })

  it('switches storage directly when the workspace has no file activity', () => {
    expect(storageChangeRequiresMigration({ adapter: 'local', root: '/prints' }, { adapter: 'local', root: '/other' }, false)).toBe(false)
  })

  it('requires migration when existing file activity would move storage', () => {
    expect(storageChangeRequiresMigration({ adapter: 'local', root: '/prints' }, { adapter: 'local', root: '/other' }, true)).toBe(true)
  })

  it('offers a migration path between every remote storage adapter', () => {
    const configs: StorageConfig[] = [
      { adapter: 'managed' },
      { adapter: 'webdav', endpoint: 'https://dav.example.com', root: 'models', username: 'user', password: 'secret' },
      {
        adapter: 's3',
        endpoint: 'https://s3.example.com',
        region: 'us-east-1',
        bucket: 'models',
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        forcePathStyle: false,
      },
      { adapter: 'dropbox', root: 'models' },
      { adapter: 'google-drive', root: 'models' },
      { adapter: 'onedrive', root: 'models' },
    ]

    const migrations = configs.flatMap((source) =>
      configs
        .filter((destination) => source.adapter !== destination.adapter)
        .map((destination) => storageChangeRequiresMigration(source, destination, true)),
    )

    expect(migrations.every(Boolean)).toBe(true)
  })

  it('does not migrate files when only storage credentials change', () => {
    const current = {
      adapter: 'webdav' as const,
      endpoint: 'https://storage.example.com/dav',
      root: 'stlquest',
      username: 'old-user',
      password: 'old-password',
    }

    expect(storageChangeRequiresMigration(current, { ...current, username: 'new-user', password: 'new-password' }, true)).toBe(false)
  })

  it('compares normalized S3 configurations without Node-only APIs', () => {
    const current = {
      adapter: 's3' as const,
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      bucket: 'prints',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      forcePathStyle: false,
    }

    expect(storageConfigChanged(current, { ...current, prefix: undefined })).toBe(false)
    expect(storageConfigChanged(current, { ...current, bucket: 'other' })).toBe(true)
  })

  it('compares WebDAV connection and folder settings', () => {
    const current = {
      adapter: 'webdav' as const,
      endpoint: 'https://storage.example.com/dav',
      root: 'stlquest',
      username: 'user',
      password: 'secret',
    }

    expect(storageConfigChanged(current, { ...current })).toBe(false)
    expect(storageConfigChanged(current, { ...current, root: 'other' })).toBe(true)
  })
})
