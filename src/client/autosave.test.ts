import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTOSAVE_DELAY_MS, combineAutosaveStatus, createAutosaver, type AutosaveState } from './autosave'

function deferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((settle, fail) => {
    resolve = settle
    reject = fail
  })
  return { promise, resolve, reject }
}

function setup(initial = 'a') {
  const saves: { value: string; done: ReturnType<typeof deferred> }[] = []
  const states: AutosaveState[] = []
  const saver = createAutosaver({
    initial,
    save: (value: string) => {
      const done = deferred()
      saves.push({ value, done })
      return done.promise
    },
    onState: (state) => states.push(state),
  })
  return { saver, saves, states, status: () => states.at(-1)?.status ?? 'idle' }
}

describe('autosave', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('waits for the delay after the last change before saving', () => {
    const { saver, saves } = setup()
    saver.change('b')
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS - 1)
    saver.change('c')
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS - 1)
    expect(saves).toHaveLength(0)
  })

  it('saves the last change once the delay passes', () => {
    const { saver, saves } = setup()
    saver.change('b')
    saver.change('c')
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS)
    expect(saves.map(({ value }) => value)).toEqual(['c'])
  })

  it('sends nothing when an edit is undone before its save', () => {
    const { saver, saves } = setup()
    saver.change('b')
    saver.change('a')
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS)
    expect(saves).toHaveLength(0)
  })

  it('never saves an invalid value', () => {
    const { saver, saves } = setup()
    saver.change('b', false)
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS)
    expect(saves).toHaveLength(0)
  })

  it('drops a waiting save once the value turns invalid', () => {
    const { saver, saves } = setup()
    saver.change('b')
    saver.change('b!', false)
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS)
    expect(saves).toHaveLength(0)
  })

  it('saves at once when flushed', () => {
    const { saver, saves } = setup()
    saver.change('b')
    void saver.flush()
    expect(saves.map(({ value }) => value)).toEqual(['b'])
  })

  it('never runs two saves at once', async () => {
    const { saver, saves } = setup()
    saver.change('b')
    void saver.flush()
    saver.change('c')
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS)
    await vi.runAllTimersAsync()
    expect(saves).toHaveLength(1)
  })

  it('saves only the newest change made during a save', async () => {
    const { saver, saves } = setup()
    saver.change('b')
    void saver.flush()
    saver.change('c')
    saver.change('d')
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS)
    saves[0].done.resolve()
    await vi.runAllTimersAsync()
    expect(saves.map(({ value }) => value)).toEqual(['b', 'd'])
  })

  it('reports a finished save', async () => {
    const { saver, saves, status } = setup()
    saver.change('b')
    const flushed = saver.flush()
    saves[0].done.resolve()
    await flushed
    expect(status()).toBe('saved')
  })

  it('reports a failed save', async () => {
    const { saver, saves, status } = setup()
    saver.change('b')
    const flushed = saver.flush()
    saves[0].done.reject(new Error('offline'))
    await flushed
    expect(status()).toBe('error')
  })

  it('sends the failed value again on retry', async () => {
    const { saver, saves } = setup()
    saver.change('b')
    const flushed = saver.flush()
    saves[0].done.reject(new Error('offline'))
    await flushed
    void saver.flush()
    expect(saves.map(({ value }) => value)).toEqual(['b', 'b'])
  })

  it('resolves a flush false when its save fails', async () => {
    const { saver, saves } = setup()
    saver.change('b')
    const flushed = saver.flush()
    saves[0].done.reject(new Error('offline'))
    expect(await flushed).toBe(false)
  })

  it('refuses a stored value while an edit waits to be saved', () => {
    const { saver } = setup()
    saver.change('b')
    expect(saver.adopt('z')).toBe(false)
  })

  it('refuses a stored value while the edit on screen is invalid', () => {
    const { saver } = setup()
    saver.change('b', false)
    expect(saver.adopt('z')).toBe(false)
  })

  it('takes a stored value when nothing is being edited', () => {
    const { saver } = setup()
    expect(saver.adopt('z')).toBe(true)
  })

  it('treats an adopted value as stored', () => {
    const { saver, saves } = setup()
    saver.adopt('z')
    saver.change('z')
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS)
    expect(saves).toHaveLength(0)
  })
})

describe('combined autosave status', () => {
  it('puts a failure first', () => {
    expect(combineAutosaveStatus(['saved', 'error', 'saving'])).toBe('error')
  })

  it('shows work in progress over a finished save', () => {
    expect(combineAutosaveStatus(['saved', 'pending'])).toBe('pending')
  })

  it('stays idle with nothing saved', () => {
    expect(combineAutosaveStatus(['idle'])).toBe('idle')
  })
})
