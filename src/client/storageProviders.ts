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
