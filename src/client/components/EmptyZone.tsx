import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, Plus, UserPlus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button, buttonVariants } from '@/components/ui/button'

/** The dashed 25%-ink outline every empty zone draws in the shape of what it holds, so the zone shows how it fills. */
const slot = 'rounded-[3px] border-2 border-dashed border-foreground/25 text-sm text-muted-foreground'

/** Each rail ticket carries its stretch of rail, so an empty rail still hangs. */
export const railStretch =
  'relative @min-[960px]:before:absolute @min-[960px]:before:-inset-x-2 @min-[960px]:before:-top-[11px] @min-[960px]:before:h-1.5 @min-[960px]:before:bg-rail/70'

/** An empty queue: what lands there, with the add action, and on a brand-new board a welcome title. */
export function EmptyQueue({
  title,
  hint,
  addLabel,
  onAdd,
  invite,
}: {
  title?: string
  hint: string
  addLabel: string
  onAdd?: () => void
  /** The label for the admin's path to inviting members, who then send their own requests. */
  invite?: string
}) {
  return (
    <div className={cn(slot, 'flex flex-col items-start gap-3 rounded-lg p-4')}>
      {title && <h3 className="font-heading text-lg leading-tight font-extrabold text-foreground uppercase">{title}</h3>}
      <p className="text-pretty">{hint}</p>
      {(onAdd || invite) && (
        <div className="flex flex-wrap gap-2">
          {onAdd && (
            <Button type="button" variant="outline" size="sm" onClick={onAdd}>
              <Plus />
              {addLabel}
            </Button>
          )}
          {invite && (
            <Link to="/settings/$section" params={{ section: 'users' }} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
              <UserPlus />
              {invite}
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

/** An empty up-next rail: a ghost lead ticket on its stretch of rail, and a pointer back to the queue when it has prints. */
export function EmptyRail({ hint, nudge }: { hint: string; nudge?: string }) {
  return (
    <>
      <div className={cn(railStretch, '@min-[960px]:max-w-[16rem] @min-[960px]:flex-[1_1_13rem]')}>
        <span
          aria-hidden="true"
          className="absolute -top-3 left-1/2 hidden h-4 w-8 -translate-x-1/2 rounded-[3px] border border-foreground/25 bg-rail @min-[960px]:block"
        />
        <p className={cn(slot, 'flex min-h-24 items-center px-3 pt-4 pb-3 text-pretty @min-[960px]:min-h-36')}>{hint}</p>
      </div>
      {nudge && (
        <p className="flex items-start gap-1.5 px-1 text-sm text-muted-foreground @min-[960px]:max-w-[16rem] @min-[960px]:flex-[1_1_9.5rem] @min-[960px]:self-center">
          <ArrowLeft aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="text-pretty">{nudge}</span>
        </p>
      )}
    </>
  )
}

/**
 * An empty printing stage: under a fleet of idle stations, one line saying how prints arrive; with no printers, a slot in
 * a station's shape holding the line and, for admins, the way to add them.
 */
export function EmptyStations({ hint, fleet, action }: { hint: string; fleet: boolean; action?: ReactNode }) {
  if (fleet) return <p className="px-1 text-sm text-pretty text-muted-foreground">{hint}</p>
  return (
    <div className={cn(slot, 'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-3 py-2.5')}>
      <p className="min-w-0 flex-[1_1_12rem] text-pretty">{hint}</p>
      {action}
    </div>
  )
}

/** The admin's way from an empty printing stage to Settings → Printers. */
export function AddPrintersLink({ label }: { label: string }) {
  return (
    <Link to="/settings/$section" params={{ section: 'printers' }} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
      <Plus />
      {label}
    </Link>
  )
}

/** An empty shelf: a slip-shaped slot holding the one line that says what lands there. */
export function EmptyShelf({ hint }: { hint: string }) {
  return <p className={cn(slot, 'px-2.5 py-2 text-pretty')}>{hint}</p>
}
