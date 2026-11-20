import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** The board's paper hang: a short bottom lip and a soft under-shadow, as if the paper curls off the rail. */
export const paperHang = 'shadow-[0_1px_0_rgb(0_0_0/0.08),0_10px_18px_-12px_rgb(0_0_0/0.5)]'

/**
 * Paper hung from its own stretch of steel rail, as the board's up-next rail hangs each ticket, so tickets side by side
 * read as one rail. An `up_next` ticket carries its stage bar; a docket carries the ink bar the calculator's dockets do.
 */
export function HungTicket({
  bar,
  className,
  children,
  ...props
}: { bar: 'up_next' | 'ink'; children: ReactNode } & ComponentProps<'article'>) {
  return (
    <article
      className={cn('relative pt-4 before:absolute before:-inset-x-3 before:top-0 before:h-1.5 before:bg-rail/70', className)}
      {...props}
    >
      <div
        data-stage={bar === 'up_next' ? bar : undefined}
        className={cn(
          'relative flex h-full flex-col rounded-[3px] bg-ticket px-4 pt-5 pb-4 text-ticket-foreground [--note:var(--ticket-note)] sm:px-6 sm:pt-6 sm:pb-5',
          paperHang,
          bar === 'ink' && '[--stage:var(--shell)]',
          'motion-safe:animate-[card-settle_420ms_cubic-bezier(0.16,1,0.3,1)_backwards] motion-safe:[animation-delay:var(--settle-delay,0ms)]',
        )}
      >
        <span
          aria-hidden="true"
          className={cn('absolute inset-x-0 top-0 h-1.5 rounded-t-[3px]', bar === 'ink' ? 'bg-shell' : 'bg-(--stage)')}
        />
        <span
          aria-hidden="true"
          className="absolute -top-4 left-1/2 h-4 w-8 -translate-x-1/2 rounded-[3px] border border-foreground/25 bg-rail"
        />
        {children}
      </div>
    </article>
  )
}

/** The dashed tear line between what a ticket is and what it carries. */
export function Perforation({ className }: { className?: string }) {
  return <hr aria-hidden="true" className={cn('border-0 border-t border-dashed border-ticket-foreground/25', className)} />
}
