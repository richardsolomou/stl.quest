import { cn } from '@/lib/utils'

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse rounded-md bg-muted [background-image:var(--grid)] [background-size:12px_12px]', className)}
      {...props}
    />
  )
}

export { Skeleton }
