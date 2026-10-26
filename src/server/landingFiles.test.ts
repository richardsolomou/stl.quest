import { afterEach, describe, expect, it, vi } from 'vitest'
import { hostedFile } from './landingFiles'

afterEach(() => vi.unstubAllEnvs())

describe('hostedFile', () => {
  it('serves the file on the hosted service', async () => {
    vi.stubEnv('STLQUEST_HOSTED', 'true')
    expect(await hostedFile(() => 'body', 'text/plain').text()).toBe('body')
  })

  it('does not exist on a self-hosted install', () => {
    vi.stubEnv('STLQUEST_HOSTED', 'false')
    expect(hostedFile(() => 'body', 'text/plain').status).toBe(404)
  })
})
