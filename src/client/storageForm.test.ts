import { describe, expect, it } from 'vitest'
import { storageConfigFromForm, storageFormValues } from './storageForm'

describe('storage form', () => {
  it('loads S3 settings without exposing the stored secret', () => {
    expect(
      storageFormValues(
        {
          adapter: 's3',
          endpoint: 'https://s3.us-east-1.amazonaws.com',
          region: 'us-east-1',
          bucket: 'models',
          prefix: 'stlquest',
          accessKeyId: 'key',
          secretAccessKey: 'secret',
          forcePathStyle: false,
        },
        true,
      ),
    ).toMatchObject({ provider: 'aws', bucket: 'models', prefix: 'stlquest', accessKeyId: 'key', secretAccessKey: '' })
  })

  it('falls back to remote storage when local storage is unavailable', () => {
    expect(storageFormValues({ adapter: 'local', root: '/prints' }, false).adapter).toBe('s3')
  })

  it('builds a Cloudflare configuration from guided fields', () => {
    const values = storageFormValues({ adapter: 'managed' }, true)

    expect(
      storageConfigFromForm({
        ...values,
        adapter: 's3',
        provider: 'cloudflare',
        accountId: 'account-id',
        bucket: 'models',
        accessKeyId: 'key',
        secretAccessKey: 'secret',
      }),
    ).toEqual({
      adapter: 's3',
      endpoint: 'https://account-id.r2.cloudflarestorage.com',
      region: 'auto',
      bucket: 'models',
      prefix: undefined,
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      forcePathStyle: false,
    })
  })

  it('preserves path-style configuration for custom S3 endpoints', () => {
    const values = storageFormValues({ adapter: 'managed' }, true)

    expect(
      storageConfigFromForm({
        ...values,
        adapter: 's3',
        provider: 'custom',
        endpoint: 'https://minio.example.com',
        bucket: 'models',
        forcePathStyle: true,
      }),
    ).toMatchObject({ endpoint: 'https://minio.example.com', forcePathStyle: true })
  })
})
