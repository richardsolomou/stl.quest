import { useState } from 'react'
import { ArrowRight, RotateCcw } from 'lucide-react'
import { CopyCells } from '@/client/components/CopyCells'
import { Button } from '@/components/ui/button'
import { workflow, type StatusId } from '@/core/workflow'
import { cn } from '@/lib/utils'
import { paperHang } from './Ticket'

const stages = workflow.statuses
const COPIES = 6
const start = (): Record<StatusId, number> => Object.fromEntries(stages.map(({ id }, index) => [id, [2, 1, 2, 1, 0][index] ?? 0]))

/**
 * One sample request for six copies, spread across the board's stages the way the board splits it. Each press moves the
 * copy nearest to done one stage on, and its cell restamps in the new stage colour exactly as it does on the board.
 */
export function CopyDemo() {
  const [counts, setCounts] = useState(start)
  const [landed, setLanded] = useState<{ stage: StatusId; move: number }>()
  const finished = (counts[stages.at(-1)!.id] ?? 0) === COPIES

  function moveOn() {
    if (finished) {
      setCounts(start())
      setLanded(undefined)
      return
    }
    const from = stages.findLastIndex(({ id }, index) => index < stages.length - 1 && (counts[id] ?? 0) > 0)
    const to = stages[from + 1]!.id
    setCounts({ ...counts, [stages[from]!.id]: counts[stages[from]!.id]! - 1, [to]: (counts[to] ?? 0) + 1 })
    setLanded({ stage: to, move: (landed?.move ?? 0) + 1 })
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 sm:p-5">
      <ol className="grid gap-2 lg:grid-cols-5 lg:gap-3">
        {stages.map(({ id, label }) => {
          const count = counts[id] ?? 0
          return (
            <li
              key={id}
              data-stage={id}
              className="grid grid-cols-[6.75rem_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[8rem_minmax(0,1fr)] lg:grid-cols-1 lg:items-start"
            >
              <p className="flex items-center gap-2 font-heading text-sm leading-none font-bold tracking-[0.015em] uppercase">
                <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[2px] bg-(--stage)" />
                {label}
                <span className="rounded-[3px] bg-(--stage) px-1.5 py-0.5 font-mono text-[11px] font-medium tracking-normal text-(--stage-foreground)">
                  {count}
                </span>
              </p>
              {count > 0 ? (
                <div
                  key={landed?.stage === id ? landed.move : undefined}
                  className={cn(
                    'flex min-h-[4.25rem] flex-col justify-between gap-2 rounded-[3px] bg-ticket px-2.5 py-2 text-ticket-foreground',
                    paperHang,
                    landed?.stage === id && 'motion-safe:animate-[card-settle_320ms_cubic-bezier(0.16,1,0.3,1)]',
                  )}
                >
                  <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span className="font-serif text-[0.95rem] leading-tight font-bold">Chess set</span>
                    <span className="font-mono text-[11px] whitespace-nowrap text-ticket-muted">
                      ×{count} of {COPIES}
                    </span>
                  </span>
                  <CopyCells counts={counts} status={id} stamp={landed?.stage === id} />
                </div>
              ) : (
                <div className="flex min-h-[4.25rem] items-center rounded-[3px] border border-dashed border-foreground/25 px-2.5 text-xs text-muted-foreground">
                  No copies here
                </div>
              )}
            </li>
          )
        })}
      </ol>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-4">
        <Button variant="outline" size="lg" onClick={moveOn}>
          {finished ? <RotateCcw aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
          {finished ? 'Start over' : 'Move a copy on'}
        </Button>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {finished
            ? `All ${COPIES} copies are ready to collect.`
            : landed
              ? `One copy moved to ${stages.find(({ id }) => id === landed.stage)!.label}.`
              : 'A sample request for six copies, as the board shows it.'}
        </p>
      </div>
    </div>
  )
}
