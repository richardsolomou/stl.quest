import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setThemePreference, themeScript } from './theme'

function browser({ stored, systemDark = false }: { stored?: string; systemDark?: boolean }) {
  const storage = new Map(stored === undefined ? [] : [['stlquest:theme', stored]])
  const listeners = new EventTarget()
  const system = Object.assign(new EventTarget(), { matches: systemDark })
  const root = { dataset: {} as Record<string, string> }
  const globals = {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    document: { documentElement: root },
    matchMedia: () => system,
    addEventListener: listeners.addEventListener.bind(listeners),
    dispatchEvent: listeners.dispatchEvent.bind(listeners),
  }
  for (const [name, value] of Object.entries(globals)) vi.stubGlobal(name, value)
  runInNewContext(themeScript, globals)
  return { root, system }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('themeScript', () => {
  it('applies a stored light choice over a dark system scheme', () => {
    expect(browser({ stored: 'light', systemDark: true }).root.dataset.theme).toBe('light')
  })

  it('applies a stored dark choice over a light system scheme', () => {
    expect(browser({ stored: 'dark' }).root.dataset.theme).toBe('dark')
  })

  it('follows a dark system scheme without a stored choice', () => {
    expect(browser({ systemDark: true }).root.dataset.theme).toBe('dark')
  })

  it('follows a light system scheme without a stored choice', () => {
    expect(browser({}).root.dataset.theme).toBe('light')
  })

  it('treats an unknown stored value as following the system', () => {
    expect(browser({ stored: 'sepia', systemDark: true }).root.dataset.theme).toBe('dark')
  })

  it('reapplies when the system scheme changes', () => {
    const { root, system } = browser({})
    system.matches = true
    system.dispatchEvent(new Event('change'))
    expect(root.dataset.theme).toBe('dark')
  })
})

describe('setThemePreference', () => {
  it('applies a new choice without a reload', () => {
    const { root } = browser({ systemDark: true })
    setThemePreference('light')
    expect(root.dataset.theme).toBe('light')
  })

  it('returns to the system scheme when set back to match it', () => {
    const { root } = browser({ stored: 'light', systemDark: true })
    setThemePreference('system')
    expect(root.dataset.theme).toBe('dark')
  })
})
