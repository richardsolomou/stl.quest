import { describe, expect, it } from 'vitest'
import type { StorageConfig } from '../core/types'
import { resolveStorageInput, storageChangeRequiresMigration, storageConfigChanged } from './storageConfig'

describe('storage configuration', () => {
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

  it('compares normalized S3 configurations', () => {
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

  it('uses the generated root for cloud storage', () => {
    expect(resolveStorageInput({ adapter: 'dropbox', root: '/models/finished/' }, { adapter: 'managed' })).toEqual({
      adapter: 'dropbox',
      root: '',
      layout: 'workspace-root-v1',
    })
  })

  it('ignores obsolete cloud folder input', () => {
    expect(resolveStorageInput({ adapter: 'onedrive', root: 'models/../private' }, { adapter: 'managed' })).toEqual({
      adapter: 'onedrive',
      root: '',
      layout: 'workspace-root-v1',
    })
  })

  it('preserves an existing WebDAV password when credentials are omitted', () => {
    const current = { adapter: 'webdav' as const, endpoint: 'https://old.example.com', root: '', username: 'user', password: 'secret' }

    expect(
      resolveStorageInput(
        { adapter: 'webdav', endpoint: 'https://new.example.com', root: '/models/', username: 'user', password: '' },
        current,
      ),
    ).toMatchObject({ endpoint: 'https://new.example.com', root: 'models', password: 'secret' })
  })
})
