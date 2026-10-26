import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Card({ className, ...props }: ComponentProps<'article'>) {
  return (
    <article
      className={cn('flex min-w-0 flex-col rounded-lg bg-card p-5 text-card-foreground ring-1 ring-foreground/10', className)}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex items-center gap-3', className)} {...props} />
}

export function CardTitle({ className, children, ...props }: ComponentProps<'h3'>) {
  return (
    <h3 className={cn('font-heading text-xl font-medium tracking-wide', className)} {...props}>
      {children}
    </h3>
  )
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex min-w-0 flex-1 flex-col', className)} {...props} />
}
