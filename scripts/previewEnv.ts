import type { StorageConfig } from '../src/core/types'

// Builds the environment block Dokploy applies to a preview application. Previews run as
// hosted deployments so managed storage and plan quotas behave the way they do in production.
const storagePassthrough = [
  'STLQUEST_HOSTED_STORAGE_BUCKET',
  'STLQUEST_HOSTED_STORAGE_ENDPOINT',
  'STLQUEST_HOSTED_STORAGE_REGION',
  'STLQUEST_HOSTED_STORAGE_ACCESS_KEY_ID',
  'STLQUEST_HOSTED_STORAGE_SECRET_ACCESS_KEY',
  'STLQUEST_HOSTED_STORAGE_FORCE_PATH_STYLE',
] as const

type Source = Record<string, string | undefined>

function value(source: Source, name: string): string | undefined {
  return source[name]?.trim() || undefined
}

// Objects land under `<configured prefix>/previews/pr-<number>` so one preview cannot read another's.
export function previewStoragePrefix(prNumber: string, configured?: string): string {
  const base = configured?.trim().replace(/^\/+|\/+$/g, '')
  return base ? `${base}/previews/pr-${prNumber}` : `previews/pr-${prNumber}`
}

/**
 * Storage for one preview, used to delete its objects when the pull request closes. The prefix
 * comes from `previewStoragePrefix` so a deletion can only ever target what the deploy wrote.
 */
export function previewStorageConfig(prNumber: string, source: Source): Extract<StorageConfig, { adapter: 's3' }> | undefined {
  const bucket = value(source, 'STLQUEST_HOSTED_STORAGE_BUCKET')
  const endpoint = value(source, 'STLQUEST_HOSTED_STORAGE_ENDPOINT')
  const accessKeyId = value(source, 'STLQUEST_HOSTED_STORAGE_ACCESS_KEY_ID')
  const secretAccessKey = value(source, 'STLQUEST_HOSTED_STORAGE_SECRET_ACCESS_KEY')
  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) return undefined
  const prefix = previewStoragePrefix(prNumber, value(source, 'STLQUEST_HOSTED_STORAGE_PREFIX'))
  // Deleting under an unqualified prefix would empty the bucket, so refuse instead of guessing.
  if (!prefix.endsWith(`/pr-${prNumber}`)) throw new Error(`preview storage prefix ${prefix} does not identify pr-${prNumber}`)
  return {
    adapter: 's3',
    bucket,
    endpoint,
    region: value(source, 'STLQUEST_HOSTED_STORAGE_REGION') ?? 'auto',
    accessKeyId,
    secretAccessKey,
    forcePathStyle: value(source, 'STLQUEST_HOSTED_STORAGE_FORCE_PATH_STYLE') === 'true',
    prefix,
  }
}

export function previewEnv(prNumber: string, webhookSecret: string | undefined, source: Source): string {
  const entries: [string, string][] = [
    ['STLQUEST_HOSTED', 'true'],
    ['STLQUEST_SEED_PREVIEW', 'true'],
  ]

  for (const name of storagePassthrough) {
    const configured = value(source, name)
    if (configured) entries.push([name, configured])
  }
  if (value(source, 'STLQUEST_HOSTED_STORAGE_BUCKET')) {
    entries.push(['STLQUEST_HOSTED_STORAGE_PREFIX', previewStoragePrefix(prNumber, value(source, 'STLQUEST_HOSTED_STORAGE_PREFIX'))])
  }

  const secretKey = value(source, 'STRIPE_SECRET_KEY')
  const supporterPriceId = value(source, 'STRIPE_SUPPORTER_PRICE_ID')
  const proPriceId = value(source, 'STRIPE_PRO_PRICE_ID')
  // The app rejects a partially configured Stripe setup, so all four move together or none do.
  if (secretKey && supporterPriceId && proPriceId && webhookSecret) {
    entries.push(
      ['STRIPE_SECRET_KEY', secretKey],
      ['STRIPE_WEBHOOK_SECRET', webhookSecret],
      ['STRIPE_SUPPORTER_PRICE_ID', supporterPriceId],
      ['STRIPE_PRO_PRICE_ID', proPriceId],
      ['STRIPE_PREVIEW_PR_NUMBER', prNumber],
    )
  }

  return entries.map(([name, entry]) => `${name}=${entry}`).join('\n')
}
