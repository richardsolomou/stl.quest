import { afterEach, describe, expect, it, vi } from 'vitest'
import { appPath, assetPath, basePath, basePathMetaName, basePathRewrite } from './basePath'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('basePath in the browser', () => {
  const page = (meta?: string) =>
    vi.stubGlobal('document', {
      querySelector: (selector: string) =>
        meta !== undefined && selector === `meta[name="${basePathMetaName}"]` ? { content: meta } : null,
    })

  it('reads the base path the root route rendered', () => {
    page('/stlquest')
    expect(basePath()).toBe('/stlquest')
  })

  it('is the root without the tag', () => {
    page()
    expect(basePath()).toBe('')
  })
})

describe('appPath', () => {
  it('is the path itself at the root', () => {
    expect(appPath('/api/health')).toBe('/api/health')
  })

  it('prefixes the base path from the environment', () => {
    vi.stubEnv('BASE_PATH', '/stlquest/')
    expect(appPath('/api/health')).toBe('/stlquest/api/health')
  })
})

describe('assetPath', () => {
  it('prefixes the server build’s root-relative URL', () => {
    vi.stubEnv('BASE_PATH', '/stlquest')
    expect(assetPath('/assets/styles.css')).toBe('/stlquest/assets/styles.css')
  })

  it('reduces the browser build’s absolute URL to the same path', () => {
    expect(assetPath('https://example.com/stlquest/assets/styles.css')).toBe('/stlquest/assets/styles.css')
  })
})

describe('basePathRewrite', () => {
  const rewrite = basePathRewrite('/stlquest')!
  const input = (href: string) => (rewrite.input!({ url: new URL(href) }) as URL).pathname
  const output = (href: string) => (rewrite.output!({ url: new URL(href) }) as URL).pathname

  it('is unnecessary at the root', () => {
    expect(basePathRewrite('')).toBeUndefined()
  })

  it('matches routes without the base path', () => {
    expect(input('http://localhost/stlquest/settings')).toBe('/settings')
  })

  it('matches a path without the base path as it is', () => {
    expect(input('http://localhost/settings')).toBe('/settings')
  })

  it('links with the base path', () => {
    expect(output('http://localhost/settings')).toBe('/stlquest/settings')
  })

  it('links to the root with a trailing slash', () => {
    expect(output('http://localhost/')).toBe('/stlquest/')
  })
})
