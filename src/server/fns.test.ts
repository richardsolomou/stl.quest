import { describe, expect, it } from 'vitest'
import { storageConfigChanged } from './fns'

describe('storage settings', () => {
  it('allows persisting the active fallback storage configuration', () => {
    expect(storageConfigChanged({ adapter: 'local', root: '/prints' }, { adapter: 'local', root: '/prints' })).toBe(false)
  })

  it('requires an empty board when the storage configuration changes', () => {
    expect(storageConfigChanged({ adapter: 'local', root: '/prints' }, { adapter: 'local', root: '/other' })).toBe(true)
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
      root: 'printhub',
      username: 'user',
      password: 'secret',
    }

    expect(storageConfigChanged(current, { ...current })).toBe(false)
    expect(storageConfigChanged(current, { ...current, root: 'other' })).toBe(true)
  })
})
