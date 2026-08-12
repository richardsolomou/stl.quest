import { describe, expect, it } from 'vitest'
import { containerPublicPort } from './containerRuntimeConfig'

describe('containerPublicPort', () => {
  it('uses port 3000 by default', () => {
    expect(containerPublicPort({})).toBe(3000)
  })

  it('uses the PORT environment variable', () => {
    expect(containerPublicPort({ PORT: '4321' })).toBe(4321)
  })

  it.each(['0', '65536', 'not-a-port'])('rejects invalid port %s', (port) => {
    expect(() => containerPublicPort({ PORT: port })).toThrow('PORT must be a valid TCP port')
  })
})
