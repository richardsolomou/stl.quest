import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Gauge } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { UsageTrackingSource } from '../../core/usageTracking'
import { updateUsageTracking } from '../../server/fns'
import { useI18n } from '../i18n'
import { signalProductTourProgress } from '../productTour'
import { sessionQuery } from '../queries'
import { useUsageTracking, useWorkspaceSlug } from '../workspace'

/** Turns usage and stock tracking on or off, then refetches the session every gate reads it from. */
export function useSetUsageTracking() {
  const workspaceSlug = useWorkspaceSlug()
  const callUpdate = useServerFn(updateUsageTracking)
  const queryClient = useQueryClient()
  return async (enabled: boolean, source: UsageTrackingSource) => {
    await callUpdate({ data: { workspaceSlug, enabled, source } })
    if (enabled) signalProductTourProgress('tracking')
    await queryClient.invalidateQueries({ queryKey: ['session'] })
  }
}

/**
 * A quiet, admin-only line offering tracking where it pays off, with one-click enable and what it does on request;
 * nothing while tracking is on. `explained` spells the explanation out for a page that would otherwise be empty.
 */
export function UsageTrackingInvite({
  source,
  line,
  explained = false,
  className,
}: {
  source: Exclude<UsageTrackingSource, 'settings'>
  line: string
  explained?: boolean
  className?: string
}) {
  const workspaceSlug = useWorkspaceSlug()
  const admin = useSuspenseQuery(sessionQuery(workspaceSlug)).data.identity?.role === 'admin'
  const tracking = useUsageTracking()
  const copy = useI18n().t.settings.board.tracking.invite
  const setTracking = useSetUsageTracking()
  const enable = useMutation({
    mutationFn: () => setTracking(true, source),
    onSuccess: () => void toast.success(copy.turnedOn),
    onError: () => void toast.error(copy.failed),
  })
  if (!admin || tracking) return null
  const turnOn = (
    <Button
      type="button"
      variant="link"
      size="sm"
      className="h-auto px-0 font-medium"
      disabled={enable.isPending}
      onClick={() => enable.mutate()}
    >
      {copy.turnOn}
    </Button>
  )
  return (
    <aside
      className={cn('grid gap-1.5 text-sm text-muted-foreground', explained && 'rounded-lg border border-dashed p-4 sm:p-5', className)}
    >
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Gauge className="size-4 shrink-0" aria-hidden="true" />
        <span>{line}</span>
        {/* A phone wraps the actions under the line, where a trailing dot would dangle. */}
        <span aria-hidden="true" className="max-sm:hidden">
          ·
        </span>
        <span className="inline-flex items-center gap-x-3">
          {turnOn}
          {!explained && (
            <Popover>
              <PopoverTrigger
                render={
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto px-0 font-normal text-muted-foreground decoration-muted-foreground/40"
                  >
                    {copy.whatItDoes}
                  </Button>
                }
              />
              <PopoverContent align="start" className="w-80 text-muted-foreground">
                {copy.explanation}
              </PopoverContent>
            </Popover>
          )}
        </span>
      </p>
      {explained && <p className="max-w-prose pl-6 leading-relaxed">{copy.explanation}</p>}
    </aside>
  )
}
