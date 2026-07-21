import { afterEach, describe, expect, it, vi } from 'vitest'
import { hostedDeployment } from './hosted'

describe('hostedDeployment', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('uses the STL Quest environment variable', () => {
    vi.stubEnv('STLQUEST_HOSTED', 'true')

    expect(hostedDeployment()).toBe(true)
  })
})
