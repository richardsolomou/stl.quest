import process from 'node:process'

const marker = '<!-- stlquest-preview -->'
const access =
  'Sign in with `preview@stl.quest` / `preview-preview-preview`. The URL is behind the shared preview basic-auth credentials. Preview data is disposable and resets on every deployment.'

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

async function github<T = unknown>(path: string, init?: { method: string; body: unknown }): Promise<T> {
  const baseUrl = process.env.GITHUB_API_URL?.trim() || 'https://api.github.com'
  const response = await fetch(`${baseUrl}${path}`, {
    method: init?.method,
    headers: {
      authorization: `Bearer ${requireEnv('GH_TOKEN')}`,
      accept: 'application/vnd.github+json',
      ...(init && { 'content-type': 'application/json' }),
    },
    body: init === undefined ? undefined : JSON.stringify(init.body),
  })
  if (!response.ok) throw new Error(`${path} failed with ${response.status}: ${await response.text()}`)
  return (await response.json()) as T
}

function commentBody(state: string, prNumber: string): string {
  if (state === 'deleted') return `${marker}\n🗑️ Preview deleted because this pull request was closed.`
  const sha = requireEnv('COMMIT_SHA').slice(0, 7)
  const url = `https://pr-${prNumber}.${requireEnv('PREVIEW_DOMAIN')}`
  const heading = {
    building: `🔄 Deploying commit \`${sha}\` — the preview below is stale until this finishes.`,
    ready: `✅ Preview is up to date with commit \`${sha}\`.`,
    failed: `❌ Deploying commit \`${sha}\` failed ([workflow run](${requireEnv('GITHUB_SERVER_URL')}/${requireEnv('GITHUB_REPOSITORY')}/actions/runs/${requireEnv('GITHUB_RUN_ID')})) — the preview below may be stale or unavailable.`,
  }[state]
  if (!heading) throw new Error(`Unknown status ${state}`)
  return `${marker}\n${heading}\n\nPreview: ${url}\n\n${access}`
}

const state = process.argv[2] ?? ''
if (!['building', 'ready', 'failed', 'deleted'].includes(state)) {
  console.error('Usage: previewComment.ts <building|ready|failed|deleted>')
  process.exit(1)
}

const repository = requireEnv('GITHUB_REPOSITORY')
const prNumber = requirePrNumber()
const body = commentBody(state, prNumber)

let existingId: number | undefined
for (let page = 1; page <= 10 && existingId === undefined; page++) {
  const comments = await github<{ id: number; body?: string }[]>(
    `/repos/${repository}/issues/${prNumber}/comments?per_page=100&page=${page}`,
  )
  existingId = comments.find((comment) => comment.body?.includes(marker))?.id
  if (comments.length < 100) break
}

if (existingId === undefined) await github(`/repos/${repository}/issues/${prNumber}/comments`, { method: 'POST', body: { body } })
else await github(`/repos/${repository}/issues/comments/${existingId}`, { method: 'PATCH', body: { body } })
console.log(`Preview comment set to ${state}`)
