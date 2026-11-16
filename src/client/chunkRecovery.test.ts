import { describe, expect, it } from 'vitest'
import { chunkRecoveryScript, updateNoticeId } from './chunkRecovery'

function page(options: { lastReload?: string; storage?: 'available' | 'blocked' } = {}) {
  const stored = new Map(options.lastReload ? [['stlquest:chunk-reload', options.lastReload]] : [])
  const notice = { hidden: true }
  const state = { reloads: 0, listener: undefined as ((event: { target: unknown }) => void) | undefined }
  const window = {
    location: {
      origin: 'https://app.example',
      reload: () => {
        state.reloads += 1
      },
    },
    sessionStorage: {
      getItem: (key: string) => {
        if (options.storage === 'blocked') throw new Error('blocked')
        return stored.get(key) ?? null
      },
      setItem: (key: string, value: string) => stored.set(key, value),
    },
    document: { getElementById: (id: string) => (id === updateNoticeId ? notice : null) },
    addEventListener: (_type: string, listener: (event: { target: unknown }) => void) => {
      state.listener = listener
    },
  }
  // oxlint-disable-next-line typescript/no-implied-eval -- the script ships as inline HTML, so the test runs the same string.
  new Function('window', chunkRecoveryScript)(window)
  const fail = (src: string, type = 'module') => state.listener?.({ target: { tagName: 'SCRIPT', type, src } })
  return { fail, notice, state }
}

describe('chunk recovery script', () => {
  it('reloads once when an entry module from this origin fails to load', () => {
    const { fail, state } = page()
    fail('https://app.example/assets/main-abc.js')
    expect(state.reloads).toBe(1)
  })

  it('shows the notice instead of reloading again within the retry window', () => {
    const { fail, notice, state } = page({ lastReload: String(Date.now()) })
    fail('https://app.example/assets/main-abc.js')
    expect({ reloads: state.reloads, hidden: notice.hidden }).toEqual({ reloads: 0, hidden: false })
  })

  it('shows the notice when session storage cannot bound the reload', () => {
    const { fail, notice, state } = page({ storage: 'blocked' })
    fail('https://app.example/assets/main-abc.js')
    expect({ reloads: state.reloads, hidden: notice.hidden }).toEqual({ reloads: 0, hidden: false })
  })

  it.each([
    ['a script from another origin', 'https://extension.example/inject.js', 'module'],
    ['a classic script', 'https://app.example/legacy.js', 'text/javascript'],
  ])('ignores %s', (_name, src, type) => {
    const { fail, notice, state } = page()
    fail(src, type)
    expect({ reloads: state.reloads, hidden: notice.hidden }).toEqual({ reloads: 0, hidden: true })
  })
})
