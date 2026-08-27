import { afterEach, describe, expect, it, vi } from 'vitest'
import { deploymentType, hostedDeployment } from './hosted'

describe('hostedDeployment', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('uses the STL Quest environment variable', () => {
    vi.stubEnv('STLQUEST_HOSTED', 'true')

    expect(hostedDeployment()).toBe(true)
  })

  it('classifies anonymous telemetry without exposing deployment details', () => {
    expect(deploymentType()).toBe('self_hosted')

    vi.stubEnv('STLQUEST_HOSTED', 'true')
    expect(deploymentType()).toBe('hosted')

    vi.stubEnv('STLQUEST_SEED_PREVIEW', 'true')
    expect(deploymentType()).toBe('preview')
  })
})
