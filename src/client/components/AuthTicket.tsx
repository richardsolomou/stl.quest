import type { ReactNode } from 'react'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * The card on the sign-in and setup screens as a ticket on the pass: paper hung from a rail tab, an ink bar across the
 * top, and a perforation between what the ticket is for and what to fill in.
 */
export function AuthTicket({ title, description, children }: { title: ReactNode; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="relative w-full pt-3">
      <span
        aria-hidden="true"
        className="absolute top-0 left-1/2 z-10 h-4 w-8 -translate-x-1/2 rounded-[3px] border border-foreground/25 bg-rail"
      />
      <Card className="w-full rounded-[3px] border-t-6 border-shell bg-ticket text-ticket-foreground shadow-xl shadow-black/10">
        <CardHeader>
          <CardTitle className="font-heading text-xl leading-tight font-extrabold uppercase">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        {children && (
          <>
            <hr aria-hidden="true" className="mx-(--card-spacing) border-0 border-t border-dashed border-ticket-foreground/25" />
            {children}
          </>
        )}
      </Card>
    </div>
  )
}
