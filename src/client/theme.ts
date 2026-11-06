import { useSyncExternalStore } from 'react'

export const themePreferences = [
  { value: 'system', label: 'Match system' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const

export type ThemePreference = (typeof themePreferences)[number]['value']
type ResolvedTheme = Exclude<ThemePreference, 'system'>

const storageKey = 'stlquest:theme'
const changeEvent = 'stlquest:theme'

/**
 * Sets `data-theme` on `<html>` before the first paint, and again whenever the stored choice or the system scheme
 * changes, so this is the only place a preference turns into a theme.
 *
 * A literal rather than a serialized function: the router reruns a head script whose text differs from the server's.
 */
export const themeScript = `(() => {
  const root = document.documentElement
  const systemDark = matchMedia('(prefers-color-scheme: dark)')
  const apply = () => {
    let preference
    try {
      preference = localStorage.getItem(${JSON.stringify(storageKey)})
    } catch {}
    root.dataset.theme = preference === 'light' || preference === 'dark' ? preference : systemDark.matches ? 'dark' : 'light'
  }
  apply()
  systemDark.addEventListener('change', apply)
  addEventListener('storage', apply)
  addEventListener(${JSON.stringify(changeEvent)}, apply)
})()`

function storedPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(storageKey)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

export function setThemePreference(preference: ThemePreference) {
  try {
    if (preference === 'system') localStorage.removeItem(storageKey)
    else localStorage.setItem(storageKey, preference)
  } catch {
    // Storage is blocked, so the choice cannot outlive this page; the theme stays as it was.
  }
  dispatchEvent(new Event(changeEvent))
}

function subscribePreference(onChange: () => void) {
  addEventListener(changeEvent, onChange)
  addEventListener('storage', onChange)
  return () => {
    removeEventListener(changeEvent, onChange)
    removeEventListener('storage', onChange)
  }
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribePreference, storedPreference, () => 'system')
}

function subscribeResolved(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}

const resolvedTheme = (): ResolvedTheme => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')

export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribeResolved, resolvedTheme, () => 'dark')
}
