import type { StorageConfig } from '../core/types'
import { CLOUD_STORAGE_PROVIDERS, CLOUD_STORAGE_PROVIDER_NAMES, type CloudStorageProvider } from '../core/auth'

export type CloudProvider = CloudStorageProvider

export const CLOUD_PROVIDERS = CLOUD_STORAGE_PROVIDERS.map((value) => ({ value, label: CLOUD_STORAGE_PROVIDER_NAMES[value] }))

export function cloudProviderLabel(provider: CloudProvider) {
  return CLOUD_PROVIDERS.find((candidate) => candidate.value === provider)!.label
}

export function isCloudAdapter(adapter: string): adapter is CloudProvider {
  return (CLOUD_STORAGE_PROVIDERS as readonly string[]).includes(adapter)
}

export const CLOUD_PROVIDER_HELP: Record<
  CloudProvider,
  { consoleUrl: string; credentials: string; intro: string; permissions: string; root: string; secret: string }
> = {
  dropbox: {
    consoleUrl: 'https://www.dropbox.com/developers/apps',
    credentials: 'Create a scoped app with App folder access, then add the redirect URI below.',
    intro: 'Dropbox stores files inside its dedicated app folder.',
    permissions: 'Enable account_info.read, files.metadata.read, files.content.read, and files.content.write.',
    root: 'Leave blank to use the Dropbox app folder directly.',
    secret: 'App secret',
  },
  'google-drive': {
    consoleUrl: 'https://console.cloud.google.com/apis/credentials',
    credentials: 'Enable the Google Drive API and create an OAuth client for a web application.',
    intro: 'Google Drive stores files in a STL Quest folder using the limited drive.file permission.',
    permissions: 'Add the redirect URI below to the OAuth client’s authorized redirect URIs.',
    root: 'Leave blank to use the STL Quest folder in Google Drive directly.',
    secret: 'Client secret',
  },
  onedrive: {
    consoleUrl: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
    credentials:
      'Register an application, choose “Any Entra ID Tenant + Personal Microsoft accounts”, then select Web under Redirect URI and paste the OAuth redirect URI shown below.',
    intro: 'OneDrive stores files inside the application’s dedicated Apps folder.',
    permissions:
      'After registering, copy the Application (client) ID, create a client secret, and add delegated Microsoft Graph permissions for User.Read, Files.ReadWrite, and offline_access.',
    root: 'Leave blank to use the OneDrive app folder directly.',
    secret: 'Client secret',
  },
}

export function storageLabel(config: StorageConfig, managedLabel = 'Included storage') {
  if (config.adapter === 'managed') return managedLabel
  if (config.adapter === 'dropbox' || config.adapter === 'google-drive' || config.adapter === 'onedrive')
    return `${cloudProviderLabel(config.adapter)}${config.root ? `/${config.root}` : ''}`
  if (config.adapter === 'local') return config.root || 'Local storage'
  if (config.adapter === 'webdav') return [config.endpoint.replace(/\/$/, ''), config.root].filter(Boolean).join('/')
  return `${config.endpoint}/${config.bucket}${config.prefix ? `/${config.prefix}` : ''}`
}

export type S3Provider = 'aws' | 'backblaze' | 'cloudflare' | 'digitalocean' | 'google-cloud' | 'custom'

export const S3_PROVIDERS: { value: S3Provider; label: string }[] = [
  { value: 'aws', label: 'Amazon S3' },
  { value: 'backblaze', label: 'Backblaze B2' },
  { value: 'cloudflare', label: 'Cloudflare R2' },
  { value: 'digitalocean', label: 'DigitalOcean Spaces' },
  { value: 'google-cloud', label: 'Google Cloud Storage' },
  { value: 'custom', label: 'Custom S3-compatible' },
]

export function s3ProviderLabel(provider: S3Provider) {
  return S3_PROVIDERS.find((candidate) => candidate.value === provider)!.label
}

export const S3_PROVIDER_HELP: Record<S3Provider, { description: string; docs: string; accessKey: string; secretKey: string }> = {
  aws: {
    description: 'Use an IAM access key with permission to read and write the selected bucket.',
    docs: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-iam.html',
    accessKey: 'Access key ID',
    secretKey: 'Secret access key',
  },
  backblaze: {
    description: 'Create an application key for the bucket and copy its S3 endpoint region.',
    docs: 'https://www.backblaze.com/docs/cloud-storage-s3-compatible-api',
    accessKey: 'Application key ID',
    secretKey: 'Application key',
  },
  cloudflare: {
    description: 'Create an R2 API token with Object Read & Write permission and copy your account ID.',
    docs: 'https://developers.cloudflare.com/r2/api/s3/tokens/',
    accessKey: 'Access key ID',
    secretKey: 'Secret access key',
  },
  digitalocean: {
    description: 'Create a Spaces access key and choose the datacenter region containing your Space.',
    docs: 'https://docs.digitalocean.com/products/spaces/how-to/manage-access/',
    accessKey: 'Spaces access key',
    secretKey: 'Spaces secret key',
  },
  'google-cloud': {
    description: 'Create an HMAC key for a service account with access to the selected bucket.',
    docs: 'https://cloud.google.com/storage/docs/authentication/hmackeys',
    accessKey: 'HMAC access ID',
    secretKey: 'HMAC secret',
  },
  custom: {
    description: 'Use the endpoint and credentials supplied by MinIO, Wasabi, your NAS, or another S3-compatible service.',
    docs: 'https://docs.aws.amazon.com/sdkref/latest/guide/feature-ss-endpoints.html',
    accessKey: 'Access key ID',
    secretKey: 'Secret access key',
  },
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
