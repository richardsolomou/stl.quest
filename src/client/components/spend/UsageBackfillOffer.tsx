import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { History } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { backfillUsage, undoUsage } from '../../../server/fns'
import { useI18n } from '../../i18n'
import { usageBackfillQuery } from '../../queries'
import { invalidateQueries } from '../../queryState'

/** A quiet line offering to fill in prints finished before tracking was on, shown only while there are some. */
export function UsageBackfillOffer({ workspaceSlug, onFilled }: { workspaceSlug: string; onFilled: (from: number) => void }) {
  const { t, locale } = useI18n()
  const copy = t.spend.backfill
  const preview = useQuery(usageBackfillQuery(workspaceSlug)).data
  const callBackfill = useServerFn(backfillUsage)
  const callUndo = useServerFn(undoUsage)
  const queryClient = useQueryClient()
  // Realtime refreshes other viewers; this page refreshes itself, so it never waits on a channel that may be down.
  const refresh = () => invalidateQueries(queryClient, 'usage', 'usage-backfill')
  const fill = useMutation({
    mutationFn: () => callBackfill({ data: { workspaceSlug } }),
    onSuccess: ({ transactionId, prints, from }) => {
      void refresh()
      if (!transactionId || from === undefined) return
      onFilled(from)
      toast.success(copy.filled(prints), {
        action: {
          label: copy.undo,
          onClick: () =>
            void callUndo({ data: { workspaceSlug, transactionId } }).then(
              () => {
                toast(copy.undone)
                void refresh()
              },
              () => toast.error(copy.undoFailed),
            ),
        },
      })
    },
    onError: () => void toast.error(copy.failed),
  })
  if (!preview?.prints || preview.from === undefined) return null
  const since = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(preview.from)
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
      <History className="size-4 shrink-0" aria-hidden="true" />
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto px-0 font-medium"
        disabled={fill.isPending}
        onClick={() => fill.mutate()}
      >
        {copy.action}
      </Button>
      <span aria-hidden="true">·</span>
      <span>{copy.since(preview.prints, since)}</span>
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
    </p>
  )
}
