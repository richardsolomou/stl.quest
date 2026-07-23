import fs from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

interface EnvironmentApplication {
  applicationId: string
  name: string
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
    headers: { 'x-api-key': requireEnv('DOKPLOY_API_KEY'), ...(options.body !== undefined && { 'content-type': 'application/json' }) },
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

async function waitForHealth(url: string, username: string, password: string) {
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
  const deadline = Date.now() + 5 * 60_000
  let lastFailure = 'no response'
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers: { authorization } })
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
  const host = `pr-${prNumber}.${requireEnv('PREVIEW_DOMAIN')}`
  const username = requireEnv('PREVIEW_BASIC_AUTH_USERNAME')
  const password = requireEnv('PREVIEW_BASIC_AUTH_PASSWORD')
  const registryUsername = process.env.PREVIEW_REGISTRY_USERNAME?.trim() || null
  const registryPassword = process.env.PREVIEW_REGISTRY_PASSWORD?.trim() || null

  let application = await findApplication(name)
  if (!application) {
    await api('application.create', { body: { name, appName: name, environmentId: requireEnv('DOKPLOY_ENVIRONMENT_ID') } })
    application = await findApplication(name)
    if (!application) throw new Error(`Dokploy did not report ${name} after creating it`)
    await api('security.create', { body: { applicationId: application.applicationId, username, password } })
    await api('domain.create', {
      body: {
        applicationId: application.applicationId,
        host,
        path: '/',
        port: 3000,
        https: true,
        certificateType: 'letsencrypt',
        domainType: 'application',
      },
    })
  }

  const applicationId = application.applicationId
  await api('application.saveDockerProvider', {
    body: {
      applicationId,
      dockerImage: image,
      username: registryUsername,
      password: registryPassword,
      registryUrl: registryUsername ? image.split('/')[0] : null,
    },
  })
  // Dokploy splits `command` on spaces, so the seed-then-serve shell line must go through `args`.
  await api('application.update', {
    body: { applicationId, args: ['/bin/sh', '-c', 'node .output/server/seed-preview.mjs && exec node .output/server/index.mjs'] },
  })
  await api('application.deploy', { body: { applicationId } })
  await waitForDeployment(applicationId)

  const url = `https://${host}`
  await waitForHealth(`${url}/api/health`, username, password)
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `preview-url=${url}\n`)
  console.log(`Preview ready at ${url}`)
}

async function remove() {
  const name = `stlquest-pr-${requirePrNumber()}`
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
  for (const application of await listApplications()) {
    const prNumber = application.name.match(/^stlquest-pr-(\d+)$/)?.[1]
    if (!prNumber) continue
    if (openPullRequests.has(prNumber)) {
      console.log(`keep ${application.name}`)
      continue
    }
    console.log(`delete ${application.name}`)
    await api('application.delete', { body: { applicationId: application.applicationId } })
  }
}

const command = process.argv[2]
if (command === 'deploy') await deploy()
else if (command === 'delete') await remove()
else if (command === 'prune') await prune()
else {
  console.error('Usage: dokployPreview.ts <deploy|delete|prune>')
  process.exit(1)
}
