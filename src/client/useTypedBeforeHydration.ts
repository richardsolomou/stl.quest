import { useLayoutEffect, useRef } from 'react'

/**
 * Returns a ref for a server-rendered form whose named inputs are controlled. Hydration keeps text typed before the
 * scripts loaded, but the next render would overwrite it with the empty state, so this hands each typed value to
 * `restore` before that render.
 */
export function useTypedBeforeHydration<Name extends string>(names: readonly Name[], restore: (name: Name, value: string) => void) {
  const form = useRef<HTMLFormElement>(null)
  useLayoutEffect(() => {
    for (const name of names) {
      const input = form.current?.elements.namedItem(name)
      if (input instanceof HTMLInputElement && input.value) restore(name, input.value)
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- Only the first mount can follow hydration.
  }, [])
  return form
}
