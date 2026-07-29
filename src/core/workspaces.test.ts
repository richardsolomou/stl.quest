import { describe, expect, it } from 'vitest'
import { workspaceNameKey, workspaceSlug } from './workspaces'

describe('workspace identity', () => {
  it('creates a stable URL slug', () => {
    expect(workspaceSlug('  Café & Models  ')).toBe('cafe-models')
  })

  it('uses a fallback when the name has no slug characters', () => {
    expect(workspaceSlug('工作室')).toBe('workspace')
  })

  it('normalizes names for duplicate detection', () => {
    expect(workspaceNameKey('  DESIGN Studio ')).toBe(workspaceNameKey('design studio'))
  })
})
