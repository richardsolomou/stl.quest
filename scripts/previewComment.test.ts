import { describe, expect, it } from 'vitest'

import { buildingHeading } from './previewCommentText'

describe('buildingHeading', () => {
  it('identifies the deployed commit that remains accessible', () => {
    expect(buildingHeading('89abcde', '✅ Preview is up to date with commit `1234567`.')).toBe(
      '🔄 Deploying commit `89abcde` — the preview below is stale until this finishes. The preview for commit `1234567` remains accessible below.',
    )
  })

  it('does not identify an unverified previous commit', () => {
    expect(buildingHeading('89abcde', '❌ Deploying commit `1234567` failed.')).toBe(
      '🔄 Deploying commit `89abcde` — the preview below is stale until this finishes.',
    )
  })
})
