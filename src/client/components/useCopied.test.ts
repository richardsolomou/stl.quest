import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeClipboard } from './useCopied'

afterEach(() => {
  vi.unstubAllGlobals()
})

// Builds a minimal `document` whose execCommand result and appended nodes are observable.
function stubExecCommandDocument(copyResult: boolean) {
  const appended: unknown[] = []
  const removed: unknown[] = []
  const body = {
    appendChild: (node: unknown) => appended.push(node),
    removeChild: (node: unknown) => removed.push(node),
  }
  const execCommand = vi.fn(() => copyResult)
  vi.stubGlobal('document', {
    body,
    createElement: () => ({ value: '', style: {}, setAttribute: () => {}, select: () => {} }),
    execCommand,
  })
  return { appended, removed, execCommand }
}

describe('writeClipboard', () => {
  it('uses the async Clipboard API when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    await expect(writeClipboard('invite-link')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('invite-link')
  })

  it('falls back to execCommand when the Clipboard API is undefined (non-secure context)', async () => {
    // Chrome leaves navigator.clipboard undefined over plain HTTP.
    vi.stubGlobal('navigator', {})
    const { appended, removed, execCommand } = stubExecCommandDocument(true)

    await expect(writeClipboard('recovery-code')).resolves.toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
    // The temporary textarea is cleaned up regardless of outcome.
    expect(appended).toHaveLength(1)
    expect(removed).toEqual(appended)
  })

  it('falls back to execCommand when the Clipboard API rejects (denied permission)', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const { execCommand } = stubExecCommandDocument(true)

    await expect(writeClipboard('value')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalled()
    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('reports failure when the fallback copy command fails', async () => {
    vi.stubGlobal('navigator', {})
    stubExecCommandDocument(false)

    await expect(writeClipboard('value')).resolves.toBe(false)
  })
})
