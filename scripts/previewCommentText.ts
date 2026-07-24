export function buildingHeading(sha: string, previousBody?: string): string {
  const previousSha = previousBody?.match(/Preview is up to date with commit `([0-9a-f]{7})`\./)?.[1]
  const previous = previousSha ? ` The preview for commit \`${previousSha}\` remains accessible below.` : ''
  return `🔄 Deploying commit \`${sha}\` — the preview below is stale until this finishes.${previous}`
}
