// Deploys PR previews by driving the Dokploy API. A replacement backend only has to
// implement deploy/delete/prune and emit the preview-url output.
import { dokployPreviewFromEnvironment, loadPreviewAppSecrets, pullRequestNumber } from 'ras-stack/preview/dokploy'

import { S3AssetStore } from '../src/adapters/s3'
import { previewEnv, previewStorageConfig } from './previewEnv'
import { deletePreviewCustomers } from './previewStripe'

// Better Auth's Stripe plugin mounts its webhook below the Better Auth handler.
const webhookPath = '/api/auth/stripe/webhook'
const webhookEvents = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]

interface WebhookEndpoint {
  id: string
  url: string
  secret?: string
}

loadPreviewAppSecrets([
  'STLQUEST_HOSTED_STORAGE_BUCKET',
  'STLQUEST_HOSTED_STORAGE_ENDPOINT',
  'STLQUEST_HOSTED_STORAGE_REGION',
  'STLQUEST_HOSTED_STORAGE_ACCESS_KEY_ID',
  'STLQUEST_HOSTED_STORAGE_SECRET_ACCESS_KEY',
  'STLQUEST_HOSTED_STORAGE_PREFIX',
  'STLQUEST_HOSTED_STORAGE_FORCE_PATH_STYLE',
  'STRIPE_SECRET_KEY',
  'STRIPE_SUPPORTER_PRICE_ID',
  'STRIPE_PRO_PRICE_ID',
])

const { config, manager } = dokployPreviewFromEnvironment()
if (!config.domain) throw new Error('PREVIEW_DOMAIN is required')
const previewDomain: string = config.domain
const previewHost = (prNumber: string) => `${config.subdomainPrefix}-${prNumber}.${previewDomain}`

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function billingConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim())
}

async function stripeApi<T = unknown>(path: string, options: { method?: string; body?: Record<string, string> } = {}): Promise<T> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers: {
      authorization: `Bearer ${requireEnv('STRIPE_SECRET_KEY')}`,
      ...(options.body !== undefined && { 'content-type': 'application/x-www-form-urlencoded' }),
    },
    body: options.body === undefined ? undefined : new URLSearchParams(options.body),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`Stripe ${path} failed with ${response.status}: ${text.slice(0, 500)}`)
  return JSON.parse(text) as T
}

// Returns the pull request a preview hostname belongs to, so pruning never touches other endpoints.
function webhookPrNumber(url: string): string | undefined {
  let hostname: string
  try {
    hostname = new URL(url).hostname
  } catch {
    return undefined
  }
  if (hostname === previewDomain || !hostname.endsWith(`.${previewDomain}`)) return undefined
  const subdomain = hostname.slice(0, -(previewDomain.length + 1))
  return subdomain.startsWith(`${config.subdomainPrefix}-`)
    ? subdomain.slice(config.subdomainPrefix.length + 1).match(/^\d+$/)?.[0]
    : undefined
}

async function listWebhookEndpoints() {
  const { data } = await stripeApi<{ data: WebhookEndpoint[] }>('webhook_endpoints?limit=100')
  return data
}

async function deleteWebhookEndpoints(keep: (prNumber: string) => boolean) {
  if (!billingConfigured()) return
  for (const endpoint of await listWebhookEndpoints()) {
    const prNumber = webhookPrNumber(endpoint.url)
    if (!prNumber || keep(prNumber)) continue
    await stripeApi(`webhook_endpoints/${endpoint.id}`, { method: 'DELETE' })
    console.log(`deleted webhook for pr-${prNumber}`)
  }
}

async function deleteStripeCustomers(prNumber: string) {
  if (!billingConfigured()) return
  const deleted = await deletePreviewCustomers(prNumber, stripeApi)
  console.log(`deleted ${deleted} Stripe customer(s) for pr-${prNumber}`)
}

// Stripe reveals a signing secret only when an endpoint is created, so every deploy replaces it.
async function syncWebhookEndpoint(prNumber: string, host: string) {
  if (!billingConfigured()) {
    console.log('STRIPE_SECRET_KEY is unset; deploying the preview without billing')
    return undefined
  }
  const url = `https://${host}${webhookPath}`
  for (const endpoint of await listWebhookEndpoints()) {
    if (endpoint.url === url) await stripeApi(`webhook_endpoints/${endpoint.id}`, { method: 'DELETE' })
  }
  const created = await stripeApi<WebhookEndpoint>('webhook_endpoints', {
    body: {
      url,
      description: `STL Quest preview pr-${prNumber}`,
      ...Object.fromEntries(webhookEvents.map((event, index) => [`enabled_events[${index}]`, event])),
    },
  })
  return created.secret
}

// Preview objects outlive the container, so closing a pull request has to clear them explicitly.
async function deletePreviewStorage(prNumber: string) {
  const storage = previewStorageConfig(prNumber, process.env)
  if (!storage) return
  await new S3AssetStore(storage).clear()
  console.log(`cleared preview storage for pr-${prNumber}`)
}

async function deploy() {
  const prNumber = pullRequestNumber(requireEnv('PR_NUMBER'))
  await deleteStripeCustomers(prNumber)
  const webhookSecret = await syncWebhookEndpoint(prNumber, previewHost(prNumber))
  await manager.deploy({
    prNumber,
    image: requireEnv('PREVIEW_IMAGE'),
    environment: previewEnv(prNumber, webhookSecret, process.env),
    ...(config.registry ? { registry: config.registry } : {}),
    configure: async ({ applicationId, client }) => {
      const details = await client.api<{ security?: { securityId: string }[] } | undefined>('application.one', {
        query: { applicationId },
      })
      for (const security of details?.security ?? []) await client.api('security.delete', { body: { securityId: security.securityId } })
      await client.api('application.update', { body: { applicationId, args: [] } })
    },
  })
}

async function remove() {
  const prNumber = pullRequestNumber(requireEnv('PR_NUMBER'))
  await deleteWebhookEndpoints((candidate) => candidate !== prNumber)
  await manager.delete(prNumber, async () => {
    await deleteStripeCustomers(prNumber)
    await deletePreviewStorage(prNumber)
  })
}

async function prune() {
  const openPullRequests = new Set((process.env.OPEN_PR_NUMBERS ?? '').split(/\s+/).filter(Boolean).map(pullRequestNumber))
  await deleteWebhookEndpoints((prNumber) => openPullRequests.has(prNumber))
  await manager.prune(openPullRequests, async (prNumber) => {
    await deletePreviewStorage(prNumber)
  })
}

const command = process.argv[2]
if (command === 'deploy') await deploy()
else if (command === 'delete') await remove()
else if (command === 'prune') await prune()
else {
  console.error('Usage: previewDeploy.ts <deploy|delete|prune>')
  process.exit(1)
}
