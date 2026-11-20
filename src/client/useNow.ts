import { useSyncExternalStore } from 'react'

const MINUTE = 60_000
let now = 0
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!timer) {
    now = Date.now()
    timer = setInterval(() => {
      now = Date.now()
      for (const notify of listeners) notify()
    }, MINUTE)
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      clearInterval(timer)
      timer = undefined
    }
  }
}

/** The time to the minute, shared by every subscriber; undefined while server rendering so ages never mismatch on hydration. */
export function useNow(): number | undefined {
  return useSyncExternalStore(
    subscribe,
    () => {
      now ||= Date.now()
      return now
    },
    () => undefined,
  )
}
