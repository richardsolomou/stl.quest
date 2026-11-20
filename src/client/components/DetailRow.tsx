import type { ReactNode } from 'react'

/** One label/value pair inside a `<dl>`. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-3 border-b border-border py-2 first:pt-0 last:border-b-0">
      <dt className="font-heading text-xs font-bold tracking-[0.015em] text-muted-foreground uppercase">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  )
}
