import { describe, expect, it } from 'vitest'

import { buildingHeading, commitCheck } from './previewCommentText'

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

describe('commitCheck', () => {
  it.each([
    ['building', { status: 'in_progress', summary: 'A new preview version is deploying.' }],
    ['ready', { status: 'completed', conclusion: 'success', summary: 'The preview is up to date.' }],
    ['failed', { status: 'completed', conclusion: 'failure', summary: 'The preview deployment failed.' }],
    ['deleted', undefined],
  ])('maps %s to its PR commit status', (state, expected) => {
    expect(commitCheck(state)).toEqual(expected)
  })
})
