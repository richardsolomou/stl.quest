import type { ComponentProps } from 'react'

/**
 * Marks for the NAS platforms STL Quest is packaged for, taken from Simple Icons (CC0-1.0). Inlined
 * rather than pulled from an icon package for two glyphs, and drawn in currentColor so they inherit
 * the chip's colour instead of introducing brand colours that would compete with the accent.
 */
const marks = {
  truenas:
    'M24 10.049v5.114l-10.949 6.324v-5.114L24 10.049zm-24 0v5.114l10.956 6.324v-5.114L0 10.049zm12.004-.605l-4.433 2.559 4.433 2.559 4.429-2.559-4.429-2.559zm10.952-1.207l-9.905-5.723v5.118l5.473 3.164 4.432-2.559zm-12-.605V2.513L1.044 8.236l4.432 2.555 5.48-3.159z',
  unraid:
    'M11.406 8.528h1.17v6.926h-1.17zM1.17 15.454H0V8.528h1.17zm4.534.828h1.17v2.645h-1.17zm-2.86-2.969h1.169v4.282h-1.17zm5.703 0h1.17v4.282h-1.17zM22.83 8.528H24v6.926h-1.17zm-4.534-.81h-1.17V5.073h1.17zm2.86 2.95h-1.169V6.406h1.17zm-5.72 0h-1.17V6.406h1.17z',
}

export function NasMark({ platform, ...props }: { platform: keyof typeof marks } & ComponentProps<'svg'>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d={marks[platform]} />
    </svg>
  )
}
