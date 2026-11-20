import { useEffect, useRef, useState, type RefObject } from 'react'
import { cn } from '@/lib/utils'
import type { StatusId } from '../../core/workflow'

/**
 * On a narrow board the stages sit side by side as lanes, most of them off screen, so this row names every stage with its
 * copy count, marks the one in view, and scrolls to any other. Wide boards show every zone heading at once and hide it.
 */
export function StageJumpBar({
  stages,
  lanes,
  className,
}: {
  stages: { id: StatusId; label: string; total: number }[]
  /** The horizontally scrolling element that holds one zone per stage, each marked with `data-status`. */
  lanes: RefObject<HTMLElement | null>
  className?: string
}) {
  const [current, setCurrent] = useState(stages[0]?.id)
  // The board rebuilds this list on every render; the observer only needs rebuilding when the stages themselves change.
  const order = stages.map(({ id }) => id).join(' ')
  useEffect(() => {
    const root = lanes.current
    if (!root) return
    const ratios = new Map<string, number>()
    // Two lanes can be fully in view on a tablet, so the leftmost mostly visible lane is the one being read.
    const observer = new IntersectionObserver(
      (records) => {
        for (const record of records) {
          const status = (record.target as HTMLElement).dataset.status
          if (status) ratios.set(status, record.intersectionRatio)
        }
        const leading = order.split(' ').find((id) => (ratios.get(id) ?? 0) >= 0.5)
        if (leading) setCurrent(leading)
      },
      { root, threshold: [0, 0.5, 0.75, 1] },
    )
    for (const zone of root.querySelectorAll<HTMLElement>(':scope .zone[data-status]')) observer.observe(zone)
    return () => observer.disconnect()
  }, [lanes, order])
  // The bar follows the lanes: the current chip scrolls fully into view, and the first and last pin to the bar's ends.
  const bar = useRef<HTMLElement>(null)
  useEffect(() => {
    const nav = bar.current
    const chip = nav?.querySelector<HTMLElement>('[aria-current]')
    if (!nav || !chip) return
    const chips = [...nav.children]
    const max = nav.scrollWidth - nav.clientWidth
    const start = chip.getBoundingClientRect().left - nav.getBoundingClientRect().left + nav.scrollLeft
    const left =
      chip === chips[0]
        ? 0
        : chip === chips.at(-1)
          ? max
          : Math.min(Math.max(nav.scrollLeft, start + chip.offsetWidth - nav.clientWidth + 12), start - 12)
    if (Math.abs(left - nav.scrollLeft) < 1) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    nav.scrollTo({ left, behavior: reduced ? 'auto' : 'smooth' })
  }, [current])
  return (
    <nav ref={bar} className={cn('no-scrollbar flex shrink-0 gap-1.5 overflow-x-auto px-3 pt-3', className)}>
      {stages.map((stage) => (
        <button
          key={stage.id}
          type="button"
          data-stage={stage.id}
          aria-current={current === stage.id ? 'true' : undefined}
          className={cn(
            'flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 font-heading text-xs leading-none font-extrabold tracking-[0.015em] uppercase transition-colors',
            current === stage.id ? 'border-transparent bg-(--stage) text-(--stage-foreground)' : 'border-border bg-card text-foreground',
          )}
          onClick={() =>
            lanes.current
              ?.querySelector<HTMLElement>(`:scope .zone[data-status="${stage.id}"]`)
              ?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' })
          }
        >
          {current !== stage.id && <span aria-hidden="true" className="size-2 rounded-[2px] bg-(--stage)" />}
          {stage.label}
          <span className="font-mono text-[11px] font-medium tracking-normal opacity-85">{stage.total}</span>
        </button>
      ))}
    </nav>
  )
}
