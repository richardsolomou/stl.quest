import { useForm } from '@tanstack/react-form'
import type { StorageConfig } from '../core/types'
import { cloudflareAccountId, inferS3Provider, s3Endpoint, type CloudProvider, type S3Provider } from './storageProviders'

export type StorageFormValues = {
  adapter: StorageConfig['adapter']
  root: string
  endpoint: string
  provider: S3Provider
  accountId: string
  region: string
  bucket: string
  prefix: string
  accessKeyId: string
  secretAccessKey: string
  username: string
  password: string
  forcePathStyle: boolean
}

export function useStorageConfigForm(defaultValues: StorageFormValues, submit: (value: StorageFormValues) => Promise<void>) {
  return useForm({ defaultValues, onSubmit: ({ value }) => submit(value) })
}

export type StorageConfigFormApi = ReturnType<typeof useStorageConfigForm>

export function storageFormValues(current: StorageConfig, localStorageAllowed: boolean): StorageFormValues {
  const s3 = current.adapter === 's3' ? current : undefined
  const webdav = current.adapter === 'webdav' ? current : undefined
  return {
    adapter: !localStorageAllowed && current.adapter === 'local' ? 's3' : current.adapter,
    root: current.adapter === 's3' || current.adapter === 'managed' ? '/prints' : current.root,
    endpoint: s3?.endpoint ?? webdav?.endpoint ?? '',
    provider: s3 ? inferS3Provider(s3.endpoint) : 'backblaze',
    accountId: cloudflareAccountId(s3?.endpoint),
    region: s3?.region ?? 'us-west-004',
    bucket: s3?.bucket ?? '',
    prefix: s3?.prefix ?? '',
    accessKeyId: s3?.accessKeyId ?? '',
    secretAccessKey: '',
    username: webdav?.username ?? '',
    password: '',
    forcePathStyle: s3?.forcePathStyle ?? true,
  }
}

export function storageConfigFromForm(value: StorageFormValues): StorageConfig {
  if (value.adapter === 'webdav') {
    return {
      adapter: 'webdav',
      endpoint: value.endpoint,
      root: value.root,
      username: value.username,
      password: value.password,
    }
  }
  if (value.adapter === 's3') {
    return {
      adapter: 's3',
      endpoint: s3Endpoint(value.provider, value.region, value.accountId, value.endpoint),
      region: value.provider === 'cloudflare' ? 'auto' : value.region,
      bucket: value.bucket,
      prefix: value.prefix || undefined,
      accessKeyId: value.accessKeyId,
      secretAccessKey: value.secretAccessKey,
      forcePathStyle: value.provider === 'custom' ? value.forcePathStyle : false,
    }
  }
  return { adapter: value.adapter, root: value.root }
}

export function rootForStorageAdapter(adapter: 'local' | 'webdav' | CloudProvider, current: StorageConfig) {
  if (adapter === current.adapter) return current.root
  return adapter === 'local' ? '/prints' : adapter === 'webdav' ? 'stlquest' : ''
}

export function s3RegionForProviderChange(provider: S3Provider, currentRegion: string) {
  if (provider === 'cloudflare') return 'auto'
  if (currentRegion === 'auto' && provider === 'digitalocean') return 'nyc3'
  if (currentRegion === 'auto' && provider === 'aws') return 'us-east-1'
  if (currentRegion === 'us-west-004' && provider === 'custom') return 'us-east-1'
  return undefined
}
