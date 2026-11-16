import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { defaultHost, hostVariable, postHogEnvironment, projectTokenVariable } from './posthog'

describe('bundledPostHog', () => {
  it('loads outside Vite, with PostHog off', () => {
    const module = JSON.stringify(new URL('posthog.ts', import.meta.url).href)
    const script = `const { bundledPostHog } = await import(${module}); process.stdout.write(String(bundledPostHog))`
    expect(execFileSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8' })).toBe('undefined')
  })
})

describe('postHogEnvironment', () => {
  it('stays off without a project token or host', () => {
    expect(postHogEnvironment({})).toBeUndefined()
  })

  it('stays off with a blank project token', () => {
    expect(postHogEnvironment({ projectToken: '  ', host: ' ' })).toBeUndefined()
  })

  it('refuses a host without a project token', () => {
    expect(() => postHogEnvironment({ host: 'https://eu.i.posthog.com' })).toThrow(
      `${projectTokenVariable} is required when ${hostVariable} is set`,
    )
  })

  it('uses the default host without a configured one', () => {
    expect(postHogEnvironment({ projectToken: ' phc_test ' })?.host).toBe(defaultHost)
  })

  it('derives the US Cloud hosts', () => {
    expect(postHogEnvironment({ projectToken: 'phc_test', host: 'https://us.i.posthog.com' })).toEqual({
      projectToken: 'phc_test',
      host: 'https://us.i.posthog.com',
      uiHost: 'https://us.posthog.com',
      assetsHost: 'https://us-assets.i.posthog.com',
    })
  })

  it('derives the EU Cloud hosts', () => {
    expect(postHogEnvironment({ projectToken: 'phc_test', host: 'https://eu.i.posthog.com/' })).toEqual({
      projectToken: 'phc_test',
      host: 'https://eu.i.posthog.com',
      uiHost: 'https://eu.posthog.com',
      assetsHost: 'https://eu-assets.i.posthog.com',
    })
  })

  it('serves everything from a self-hosted instance', () => {
    expect(postHogEnvironment({ projectToken: 'phc_test', host: 'https://posthog.example.com/' })).toEqual({
      projectToken: 'phc_test',
      host: 'https://posthog.example.com',
      uiHost: 'https://posthog.example.com',
      assetsHost: 'https://posthog.example.com',
    })
  })

  it.each(['file:///tmp/posthog', 'https://user:secret@posthog.example.com', 'https://posthog.example.com/?token=1', 'posthog'])(
    'rejects %s as a host',
    (host) => {
      expect(() => postHogEnvironment({ projectToken: 'phc_test', host })).toThrow(
        `${hostVariable} must be an HTTP URL without credentials, query, or fragment`,
      )
    },
  )
})
