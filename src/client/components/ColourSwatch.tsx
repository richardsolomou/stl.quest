import { cn } from '@/lib/utils'

export function ColourSwatch({ hex, className }: { hex: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block size-3 shrink-0 rounded-full border border-foreground/20', className)}
      style={{ backgroundColor: hex }}
    />
  )
}
