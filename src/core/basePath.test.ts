import { describe, expect, it } from 'vitest'
import { normalizeBasePath, stripBasePath } from './basePath'

describe('normalizeBasePath', () => {
  it('is empty when unset', () => {
    expect(normalizeBasePath(undefined)).toBe('')
  })

  it('is empty for the root', () => {
    expect(normalizeBasePath('/')).toBe('')
  })

  it('drops a trailing slash', () => {
    expect(normalizeBasePath('/stlquest/')).toBe('/stlquest')
  })

  it('adds a missing leading slash', () => {
    expect(normalizeBasePath('stlquest')).toBe('/stlquest')
  })

  it('keeps nested segments', () => {
    expect(normalizeBasePath('/apps/stlquest')).toBe('/apps/stlquest')
  })

  it('rejects a full URL', () => {
    expect(() => normalizeBasePath('https://example.com/stlquest')).toThrow('BASE_PATH')
  })

  it('rejects a query', () => {
    expect(() => normalizeBasePath('/stlquest?x=1')).toThrow('BASE_PATH')
  })

  it('rejects dot segments', () => {
    expect(() => normalizeBasePath('/apps/../stlquest')).toThrow('BASE_PATH')
  })

  it('rejects empty segments', () => {
    expect(() => normalizeBasePath('/apps//stlquest')).toThrow('BASE_PATH')
  })
})

describe('stripBasePath', () => {
  it('leaves paths alone without a base path', () => {
    expect(stripBasePath('', '/api/health')).toBe('/api/health')
  })

  it('removes the base path', () => {
    expect(stripBasePath('/stlquest', '/stlquest/api/health')).toBe('/api/health')
  })

  it('maps the bare base path to the root', () => {
    expect(stripBasePath('/stlquest', '/stlquest')).toBe('/')
  })

  it('maps the base path with a trailing slash to the root', () => {
    expect(stripBasePath('/stlquest', '/stlquest/')).toBe('/')
  })

  it('ignores a path that only shares a prefix', () => {
    expect(stripBasePath('/stlquest', '/stlquests/api')).toBeUndefined()
  })

  it('ignores a path outside the base path', () => {
    expect(stripBasePath('/stlquest', '/api/health')).toBeUndefined()
  })
})
