import { describe, expect, it } from 'vitest'

import { previewEnv, previewStorageConfig, previewStoragePrefix } from './previewEnv'

const stripe = {
  STRIPE_SECRET_KEY: 'sk_test_key',
  STRIPE_SUPPORTER_PRICE_ID: 'price_supporter',
  STRIPE_PRO_PRICE_ID: 'price_pro',
}

const storage = {
  STLQUEST_HOSTED_STORAGE_BUCKET: 'stlquest-previews',
  STLQUEST_HOSTED_STORAGE_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
}

describe('previewStoragePrefix', () => {
  it('isolates a preview below the configured prefix', () => {
    expect(previewStoragePrefix('180', 'shared')).toBe('shared/previews/pr-180')
  })

  it('isolates a preview when no prefix is configured', () => {
    expect(previewStoragePrefix('180', undefined)).toBe('previews/pr-180')
  })

  it('ignores surrounding slashes on the configured prefix', () => {
    expect(previewStoragePrefix('180', '/shared/')).toBe('shared/previews/pr-180')
  })
})

describe('previewEnv', () => {
  it('runs previews as hosted deployments', () => {
    expect(previewEnv('180', undefined, {})).toBe('STLQUEST_HOSTED=true')
  })

  it('scopes managed storage to the preview', () => {
    expect(previewEnv('180', undefined, storage)).toContain('STLQUEST_HOSTED_STORAGE_PREFIX=previews/pr-180')
  })

  it('omits the storage prefix when no bucket is configured', () => {
    expect(previewEnv('180', undefined, { STLQUEST_HOSTED_STORAGE_REGION: 'auto' })).not.toContain('STLQUEST_HOSTED_STORAGE_PREFIX')
  })

  it('configures billing when every value is available', () => {
    expect(previewEnv('180', 'whsec_preview', stripe)).toContain('STRIPE_WEBHOOK_SECRET=whsec_preview')
  })

  it('omits billing when the webhook secret is missing', () => {
    expect(previewEnv('180', undefined, stripe)).not.toContain('STRIPE_SECRET_KEY')
  })

  it('omits billing when a price is missing', () => {
    expect(previewEnv('180', 'whsec_preview', { ...stripe, STRIPE_PRO_PRICE_ID: '' })).not.toContain('STRIPE_SECRET_KEY')
  })
})

describe('previewStorageConfig', () => {
  const credentials = {
    ...storage,
    STLQUEST_HOSTED_STORAGE_ACCESS_KEY_ID: 'key',
    STLQUEST_HOSTED_STORAGE_SECRET_ACCESS_KEY: 'secret',
  }

  it('targets exactly the prefix the deploy wrote', () => {
    expect(previewStorageConfig('180', credentials)?.prefix).toBe(previewStoragePrefix('180', undefined))
  })

  it('nests below a configured parent prefix', () => {
    expect(previewStorageConfig('180', { ...credentials, STLQUEST_HOSTED_STORAGE_PREFIX: 'shared' })?.prefix).toBe('shared/previews/pr-180')
  })

  it('defaults the region the way managed storage does', () => {
    expect(previewStorageConfig('180', credentials)?.region).toBe('auto')
  })

  it('has nothing to delete when storage is not configured', () => {
    expect(previewStorageConfig('180', {})).toBeUndefined()
  })

  it('has nothing to delete when only some credentials are present', () => {
    expect(previewStorageConfig('180', storage)).toBeUndefined()
  })
})
