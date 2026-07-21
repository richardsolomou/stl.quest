import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Brand({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      className={cn('inline-flex items-center gap-2 font-heading text-xl font-medium tracking-[0.03em] uppercase', className)}
      {...props}
    >
      <img src="/favicon.svg" alt="" aria-hidden="true" className="size-[1.15em] shrink-0" />
      PrintHub
    </span>
  )
}

export function RailBrand({ className, ...props }: ComponentProps<'img'>) {
  return <img src="/favicon.svg" alt="PrintHub" className={cn('size-8 shrink-0', className)} {...props} />
}

export function AuthBrand() {
  return (
    <div className="text-center">
      <Brand className="text-3xl" />
    </div>
  )
}
