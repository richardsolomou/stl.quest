import { cn } from '@/lib/utils'
import type { StatusId } from '../../core/workflow'

export function StatusDot({ status }: { status: StatusId }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'size-2 shrink-0 rounded-full bg-muted-foreground',
        status === 'up_next' && 'bg-blueprint',
        status === 'in_progress' && 'bg-primary',
        status === 'post_processing' && 'bg-[var(--chart-4)]',
        status === 'done' && 'bg-[var(--chart-2)]',
      )}
    />
  )
}
