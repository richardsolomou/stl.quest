// Deploys PR previews by driving the Dokploy API. A replacement backend only has to
// implement deploy/delete/prune and emit the preview-url output.
import fs from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

import { S3AssetStore } from '../src/adapters/s3'
import { previewEnv, previewStorageConfig } from './previewEnv'
import { deletePreviewCustomers } from './previewStripe'

const previewDomain = 'stl.quest'

// Better Auth's Stripe plugin mounts its webhook below the Better Auth handler.
const webhookPath = '/api/auth/stripe/webhook'
const webhookEvents = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]

interface EnvironmentApplication {
  applicationId: string
  name: string
}

interface WebhookEndpoint {
  id: string
  url: string
  secret?: string
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function requirePrNumber(): string {
  const value = requireEnv('PR_NUMBER')
  if (!/^\d+$/.test(value)) throw new Error('PR_NUMBER must be a pull request number')
  return value
}

async function api<T = unknown>(procedure: string, options: { query?: Record<string, string>; body?: unknown } = {}): Promise<T> {
  const url = new URL(`${requireEnv('DOKPLOY_URL').replace(/\/$/, '')}/api/${procedure}`)
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value)
  console.log(`→ ${procedure}`)
  const response = await fetch(url, {
    method: options.body === undefined ? 'GET' : 'POST',
    headers: {
      'x-api-key': requireEnv('DOKPLOY_API_KEY'),
      ...(options.body !== undefined && { 'content-type': 'application/json' }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${procedure} failed with ${response.status}: ${text.slice(0, 500)}`)
  if (!text) return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`${procedure} returned ${response.status} with a non-JSON body: ${text.slice(0, 200)}`)
  }
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
  return hostname.slice(0, -(previewDomain.length + 1)).match(/^pr-(\d+)$/)?.[1]
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
  const config = previewStorageConfig(prNumber, process.env)
  if (!config) return
  await new S3AssetStore(config).clear()
  console.log(`cleared preview storage for pr-${prNumber}`)
}

async function listApplications() {
  const environment = await api<{ applications?: EnvironmentApplication[] } | undefined>('environment.one', {
    query: { environmentId: requireEnv('DOKPLOY_ENVIRONMENT_ID') },
  })
  if (!environment) throw new Error('environment.one returned an empty response; check DOKPLOY_URL and DOKPLOY_ENVIRONMENT_ID')
  return environment.applications ?? []
}

async function findApplication(name: string) {
  return (await listApplications()).find((application) => application.name === name)
}

async function waitForDeployment(applicationId: string) {
  const deadline = Date.now() + 10 * 60_000
  while (Date.now() < deadline) {
    await sleep(5_000)
    const { applicationStatus } = await api<{ applicationStatus: string }>('application.one', { query: { applicationId } })
    if (applicationStatus === 'done') return
    if (applicationStatus === 'error') throw new Error('Dokploy reported a failed deployment; check its deployment logs')
  }
  throw new Error('Timed out waiting for the Dokploy deployment to finish')
}

async function waitForHealth(url: string) {
  const deadline = Date.now() + 5 * 60_000
  let lastFailure = 'no response'
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.status === 200) return
      lastFailure = `status ${response.status}`
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error)
    }
    await sleep(5_000)
  }
  throw new Error(`Timed out waiting for ${url} (${lastFailure})`)
}

async function deploy() {
  const prNumber = requirePrNumber()
  const name = `stlquest-pr-${prNumber}`
  const image = requireEnv('PREVIEW_IMAGE')
  const host = `pr-${prNumber}.${previewDomain}`
  const registryUsername = process.env.PREVIEW_REGISTRY_USERNAME?.trim() || null
  const registryPassword = process.env.PREVIEW_REGISTRY_PASSWORD?.trim() || null

  await deleteStripeCustomers(prNumber)

  let application = await findApplication(name)
  if (!application) {
    await api('application.create', { body: { name, appName: name, environmentId: requireEnv('DOKPLOY_ENVIRONMENT_ID') } })
    application = await findApplication(name)
    if (!application) throw new Error(`Dokploy did not report ${name} after creating it`)
  }

  const applicationId = application.applicationId
  const details = await api<{ domains?: { host: string }[]; security?: { securityId: string }[] } | undefined>('application.one', {
    query: { applicationId },
  })
  for (const security of details?.security ?? []) await api('security.delete', { body: { securityId: security.securityId } })
  if (!details?.domains?.some((domain) => domain.host === host)) {
    await api('domain.create', {
      body: {
        applicationId,
        host,
        path: '/',
        port: 3000,
        https: true,
        certificateType: 'letsencrypt',
        domainType: 'application',
      },
    })
  }
  await api('application.saveDockerProvider', {
    body: {
      applicationId,
      dockerImage: image,
      username: registryUsername,
      password: registryPassword,
      registryUrl: registryUsername ? image.split('/')[0] : null,
    },
  })
  await api('application.update', {
    body: { applicationId, args: [] },
  })
  const webhookSecret = await syncWebhookEndpoint(prNumber, host)
  await api('application.saveEnvironment', {
    body: {
      applicationId,
      env: previewEnv(prNumber, webhookSecret, process.env),
      buildArgs: null,
      buildSecrets: null,
      createEnvFile: false,
    },
  })
  await api('application.deploy', { body: { applicationId } })
  await waitForDeployment(applicationId)

  const url = `https://${host}`
  await waitForHealth(`${url}/api/health`)
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `preview-url=${url}\n`)
  console.log(`Preview ready at ${url}`)
}

async function remove() {
  const prNumber = requirePrNumber()
  const name = `stlquest-pr-${prNumber}`
  await deleteWebhookEndpoints((candidate) => candidate !== prNumber)
  await deleteStripeCustomers(prNumber)
  await deletePreviewStorage(prNumber)
  const application = await findApplication(name)
  if (!application) {
    console.log(`No Dokploy application named ${name}`)
    return
  }
  await api('application.delete', { body: { applicationId: application.applicationId } })
  console.log(`Deleted ${name}`)
}

async function prune() {
  const openPullRequests = new Set((process.env.OPEN_PR_NUMBERS ?? '').split(/\s+/).filter(Boolean))
  await deleteWebhookEndpoints((prNumber) => openPullRequests.has(prNumber))
  for (const application of await listApplications()) {
    const prNumber = application.name.match(/^stlquest-pr-(\d+)$/)?.[1]
    if (!prNumber) continue
    if (openPullRequests.has(prNumber)) {
      console.log(`keep ${application.name}`)
      continue
    }
    console.log(`delete ${application.name}`)
    await deletePreviewStorage(prNumber)
    await api('application.delete', { body: { applicationId: application.applicationId } })
  }
}

const command = process.argv[2]
if (command === 'deploy') await deploy()
else if (command === 'delete') await remove()
else if (command === 'prune') await prune()
else {
  console.error('Usage: previewDeploy.ts <deploy|delete|prune>')
  process.exit(1)
}
