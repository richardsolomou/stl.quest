function previousPreview(previousBody?: string): string {
  const previousSha = previousBody?.match(/Preview is up to date with commit `([0-9a-f]{7})`\./)?.[1]
  return previousSha ? ` The preview for commit \`${previousSha}\` remains accessible below.` : ''
}

export function buildingHeading(sha: string, previousBody?: string): string {
  return `🔄 Deploying commit \`${sha}\` — the preview below is stale until this finishes.${previousPreview(previousBody)}`
}

export function awaitingHeading(sha: string, previousBody?: string): string {
  return `⏸️ Preview for commit \`${sha}\` is waiting for the preview build workflow to be approved.${previousPreview(previousBody)}`
}

export function commitCheck(state: string): { status: string; conclusion?: string; summary: string } | undefined {
  if (state === 'awaiting') return { status: 'queued', summary: 'The preview build is waiting for workflow approval.' }
  if (state === 'building') return { status: 'in_progress', summary: 'A new preview version is deploying.' }
  if (state === 'ready') return { status: 'completed', conclusion: 'success', summary: 'The preview is up to date.' }
  if (state === 'failed') return { status: 'completed', conclusion: 'failure', summary: 'The preview deployment failed.' }
}
