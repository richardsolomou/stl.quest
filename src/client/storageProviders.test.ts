import { describe, expect, it } from 'vitest'
import { cloudflareAccountId, inferS3Provider, s3Endpoint } from './storageProviders'

describe('storage provider presets', () => {
  it('builds provider endpoints from the guided fields', () => {
    expect(s3Endpoint('backblaze', 'us-west-004', '', '')).toBe('https://s3.us-west-004.backblazeb2.com')
    expect(s3Endpoint('cloudflare', 'auto', 'account-id', '')).toBe('https://account-id.r2.cloudflarestorage.com')
  })

  it.each([
    ['https://s3.us-east-1.amazonaws.com', 'aws'],
    ['https://s3.us-west-004.backblazeb2.com', 'backblaze'],
    ['https://abc123.r2.cloudflarestorage.com', 'cloudflare'],
    ['https://nyc3.digitaloceanspaces.com', 'digitalocean'],
    ['https://bucket.storage.googleapis.com', 'google-cloud'],
  ] as const)('infers %s as %s', (endpoint, provider) => {
    expect(inferS3Provider(endpoint)).toBe(provider)
  })

  it.each([
    'https://amazonaws.com.evil.example',
    'https://evilbackblazeb2.com',
    'https://r2.cloudflarestorage.com@evil.example',
    'https://evil.example/digitaloceanspaces.com',
    'https://evil.example?endpoint=storage.googleapis.com',
  ])('keeps lookalike endpoint %s custom', (endpoint) => {
    expect(inferS3Provider(endpoint)).toBe('custom')
  })

  it('extracts the Cloudflare account ID from its endpoint', () => {
    expect(cloudflareAccountId('https://abc123.r2.cloudflarestorage.com')).toBe('abc123')
  })
})
