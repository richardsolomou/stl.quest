export const AUTOSAVE_DELAY_MS = 600

export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error'
export type AutosaveState = { status: AutosaveStatus; error?: unknown }

type Timers = { set: (callback: () => void, ms: number) => unknown; clear: (handle: unknown) => void }

const globalTimers: Timers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/**
 * Stores an edited value some time after its last change, one save at a time: a value that changes while a save runs is
 * saved after it, so the newest always wins, and an invalid value is never sent, leaving the last valid one stored.
 * Values compare by their JSON, so an edit undone before its save sends nothing.
 */
export function createAutosaver<T>({
  initial,
  save,
  onState,
  delay = AUTOSAVE_DELAY_MS,
  timers = globalTimers,
}: {
  initial: T
  save: (value: T) => Promise<unknown>
  onState: (state: AutosaveState) => void
  delay?: number
  timers?: Timers
}) {
  let saved = JSON.stringify(initial)
  // What is on screen, undefined while it is invalid.
  let edited: string | undefined = saved
  // The newest valid value that is not stored yet, kept after a failure so a retry can send it.
  let next: { value: T; key: string } | undefined
  let timer: unknown
  let running: Promise<boolean> | undefined
  let everSaved = false
  let state: AutosaveState = { status: 'idle' }

  const report = (update: AutosaveState) => {
    if (update.status === state.status && update.error === state.error) return
    state = update
    onState(update)
  }
  const settle = () => report({ status: everSaved ? 'saved' : 'idle' })
  const cancel = () => {
    if (timer === undefined) return
    timers.clear(timer)
    timer = undefined
  }

  function change(value: T, valid = true) {
    if (!valid) {
      edited = undefined
      next = undefined
      cancel()
      if (!running) settle()
      return
    }
    const key = JSON.stringify(value)
    if (key === edited) return
    edited = key
    cancel()
    if (key === saved && !running) {
      next = undefined
      settle()
      return
    }
    next = { value, key }
    if (state.status !== 'saving') report({ status: 'pending' })
    timer = timers.set(() => {
      timer = undefined
      void flush()
    }, delay)
  }

  /** Saves what is waiting now; resolves false only when that save failed. */
  function flush(): Promise<boolean> {
    cancel()
    if (running) return running.then(() => flush())
    if (!next || next.key === saved) {
      next = undefined
      settle()
      return Promise.resolve(true)
    }
    const item = next
    report({ status: 'saving' })
    const current = save(item.value).then(
      () => {
        saved = item.key
        everSaved = true
        if (next?.key === item.key) next = undefined
        return { ok: true as const }
      },
      (error: unknown) => ({ ok: false as const, error }),
    )
    running = current.then((result) => {
      running = undefined
      // A newer change already waiting for its delay is the retry.
      if (timer !== undefined) {
        report({ status: 'pending' })
        return result.ok
      }
      if (!result.ok) {
        report({ status: 'error', error: result.error })
        return false
      }
      if (next) return flush()
      settle()
      return true
    })
    return running
  }

  return {
    change,
    flush,
    /**
     * Takes a value stored elsewhere, such as a realtime refetch, as the saved one, but only while nothing is being
     * edited or saved, so an edit in progress is never overwritten. Returns whether the caller should show it.
     */
    adopt: (value: T) => {
      if (timer !== undefined || running || next || edited !== saved) return false
      saved = JSON.stringify(value)
      edited = saved
      return true
    },
  }
}

/** One status for several autosaved forms on a page: a failure first, then work in progress, then a finished save. */
export function combineAutosaveStatus(statuses: AutosaveStatus[]): AutosaveStatus {
  const order: AutosaveStatus[] = ['error', 'saving', 'pending', 'saved']
  return order.find((status) => statuses.includes(status)) ?? 'idle'
}
