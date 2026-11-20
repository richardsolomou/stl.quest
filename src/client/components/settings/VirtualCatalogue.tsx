import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { VirtualRow } from '../VirtualRow'

// Below this the picker is phone-width and its cards stack in one column.
const TWO_COLUMNS_FROM = 480
// Enough placeholder rows to fill the picker while its catalogue loads.
const LOADING_ROWS = 6

type CatalogueRow<Item> =
  | { key: string; kind: 'before' }
  | { key: string; kind: 'heading'; title: string; count: number }
  | { key: string; kind: 'cards'; items: Item[] }
  | { key: string; kind: 'loading' }

/**
 * A picker's catalogue as one virtual list, so hundreds of products render only what is in view: whatever comes
 * `before` (the custom card, a no-match line), then each group's uppercase heading with its count above its cards, two
 * to a row when the picker is wide enough, or placeholder cards until `groups` arrive. It owns the picker's scrolling, and
 * starts again at the top for each `query`.
 */
export function VirtualCatalogue<Item>({
  before,
  groups,
  query,
  getKey,
  renderItem,
}: {
  before?: ReactNode
  /** A group without a title lists its cards without a heading; none yet while the catalogue loads. */
  groups: { title?: string; items: readonly Item[] }[] | undefined
  query: string
  getKey: (item: Item) => string
  renderItem: (item: Item) => ReactNode
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [columns, setColumns] = useState(1)
  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const observer = new ResizeObserver(() => setColumns(element.clientWidth >= TWO_COLUMNS_FROM ? 2 : 1))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const rows: CatalogueRow<Item>[] = before ? [{ key: 'before', kind: 'before' }] : []
  if (!groups) for (let row = 0; row < LOADING_ROWS; row++) rows.push({ key: `loading:${row}`, kind: 'loading' })
  for (const group of groups ?? []) {
    if (group.title) rows.push({ key: `heading:${group.title}`, kind: 'heading', title: group.title, count: group.items.length })
    for (let at = 0; at < group.items.length; at += columns) {
      const items = group.items.slice(at, at + columns)
      rows.push({ key: items.map(getKey).join(':'), kind: 'cards', items })
    }
  }
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => rows[index].key,
    estimateSize: (index) => (rows[index].kind === 'heading' ? 36 : 88),
    overscan: 6,
  })
  useEffect(() => virtualizer.scrollToOffset(0), [virtualizer, query])

  return (
    <div ref={scrollRef} aria-busy={!groups} className="app-scrollbar min-h-0 flex-1 overflow-y-auto pr-1">
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtual) => {
          const row = rows[virtual.index]
          return (
            <VirtualRow
              key={row.key}
              index={virtual.index}
              start={virtual.start}
              measureElement={virtualizer.measureElement}
              className={row.kind === 'before' ? 'pb-4' : 'pb-2'}
            >
              {row.kind === 'before' && before}
              {row.kind === 'heading' && (
                <h3 className="px-1 pt-2 font-heading text-sm font-extrabold tracking-[0.015em] uppercase">
                  {row.title} · {row.count}
                </h3>
              )}
              {row.kind === 'cards' && <div className={cn('grid gap-2', columns === 2 && 'grid-cols-2')}>{row.items.map(renderItem)}</div>}
              {row.kind === 'loading' && (
                <div className={cn('grid gap-2', columns === 2 && 'grid-cols-2')}>
                  {Array.from({ length: columns }, (_, column) => (
                    <Skeleton key={column} className="h-21 rounded-lg" />
                  ))}
                </div>
              )}
            </VirtualRow>
          )
        })}
      </div>
    </div>
  )
}
