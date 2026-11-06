import type { StorageConfig } from '../core/types'
import { CLOUD_STORAGE_PROVIDERS, CLOUD_STORAGE_PROVIDER_NAMES, type CloudStorageProvider } from '../core/auth'
import type { Messages } from '../core/i18n'

export type CloudProvider = CloudStorageProvider

export const CLOUD_PROVIDERS = CLOUD_STORAGE_PROVIDERS.map((value) => ({ value, label: CLOUD_STORAGE_PROVIDER_NAMES[value] }))

export function cloudProviderLabel(provider: CloudProvider) {
  return CLOUD_PROVIDERS.find((candidate) => candidate.value === provider)!.label
}

export function isCloudAdapter(adapter: string): adapter is CloudProvider {
  return (CLOUD_STORAGE_PROVIDERS as readonly string[]).includes(adapter)
}

export type StorageMessages = Messages['storage']

export function storageRecoveryHint(t: StorageMessages, adapter: StorageConfig['adapter']) {
  return adapter === 'managed' || adapter === 'local' || adapter === 'webdav' || adapter === 's3'
    ? t.recoveryHint[adapter]
    : t.recoveryHint.cloud
}

export const CLOUD_PROVIDER_CONSOLES: Record<CloudProvider, string> = {
  dropbox: 'https://www.dropbox.com/developers/apps',
  'google-drive': 'https://console.cloud.google.com/apis/credentials',
  onedrive: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
  box: 'https://app.box.com/developers/console',
}

export function storageLabel(config: StorageConfig, t: StorageMessages) {
  if (config.adapter === 'managed') return t.label.managed
  if (config.adapter === 'dropbox' || config.adapter === 'google-drive' || config.adapter === 'onedrive' || config.adapter === 'box')
    return cloudProviderLabel(config.adapter)
  if (config.adapter === 'local') return config.root || t.label.local
  if (config.adapter === 'webdav') return [config.endpoint.replace(/\/$/, ''), config.root].filter(Boolean).join('/')
  return `${config.endpoint}/${config.bucket}${config.prefix ? `/${config.prefix}` : ''}`
}

export type S3Provider = 'aws' | 'backblaze' | 'cloudflare' | 'digitalocean' | 'google-cloud' | 'custom'

export const S3_PROVIDERS: S3Provider[] = ['aws', 'backblaze', 'cloudflare', 'digitalocean', 'google-cloud', 'custom']

export const S3_PROVIDER_DOCS: Record<S3Provider, string> = {
  aws: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-iam.html',
  backblaze: 'https://www.backblaze.com/docs/cloud-storage-s3-compatible-api',
  cloudflare: 'https://developers.cloudflare.com/r2/api/s3/tokens/',
  digitalocean: 'https://docs.digitalocean.com/products/spaces/how-to/manage-access/',
  'google-cloud': 'https://cloud.google.com/storage/docs/authentication/hmackeys',
  custom: 'https://docs.aws.amazon.com/sdkref/latest/guide/feature-ss-endpoints.html',
}

export function inferS3Provider(endpoint = ''): S3Provider {
  const hostname = endpointHostname(endpoint)
  if (matchesDomain(hostname, 'amazonaws.com')) return 'aws'
  if (matchesDomain(hostname, 'backblazeb2.com')) return 'backblaze'
  if (matchesDomain(hostname, 'r2.cloudflarestorage.com')) return 'cloudflare'
  if (matchesDomain(hostname, 'digitaloceanspaces.com')) return 'digitalocean'
  if (matchesDomain(hostname, 'storage.googleapis.com')) return 'google-cloud'
  return 'custom'
}

function endpointHostname(endpoint: string) {
  try {
    return new URL(endpoint).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function matchesDomain(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}

export function cloudflareAccountId(endpoint = '') {
  return endpoint.match(/^https:\/\/([^.]+)\.r2\.cloudflarestorage\.com\/?$/)?.[1] ?? ''
}

export function s3Endpoint(provider: S3Provider, region: string, accountId: string, customEndpoint: string) {
  switch (provider) {
    case 'aws':
      return `https://s3.${region}.amazonaws.com`
    case 'backblaze':
      return `https://s3.${region}.backblazeb2.com`
    case 'cloudflare':
      return `https://${accountId}.r2.cloudflarestorage.com`
    case 'digitalocean':
      return `https://${region}.digitaloceanspaces.com`
    case 'google-cloud':
      return 'https://storage.googleapis.com'
    case 'custom':
      return customEndpoint
  }
}
