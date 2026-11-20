import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { VirtualRow } from '../VirtualRow'

/**
 * A settings list of bordered rows that renders only the rows in view of the page's scrolling, so a library of
 * hundreds stays light. Scrolls `scrollToKey`'s row into view when it is set, such as an item just added.
 */
export function VirtualList<Item>({
  items,
  getKey,
  renderItem,
  scrollToKey,
}: {
  items: readonly Item[]
  getKey: (item: Item) => string
  renderItem: (item: Item) => ReactNode
  scrollToKey?: string
}) {
  const listRef = useRef<HTMLUListElement>(null)
  const [scroller, setScroller] = useState<HTMLElement | null>(null)
  // Where the list starts in the scrolling content, which moves as anything above it grows or shrinks.
  const [scrollMargin, setScrollMargin] = useState(0)
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const parent = scrollParent(list)
    setScroller(parent)
    const measure = () => setScrollMargin(list.getBoundingClientRect().top - parent.getBoundingClientRect().top + parent.scrollTop)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(parent.firstElementChild ?? parent)
    return () => observer.disconnect()
  }, [])
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller,
    getItemKey: (index) => getKey(items[index]),
    estimateSize: () => 57,
    overscan: 8,
    scrollMargin,
  })
  const target = scrollToKey ? items.findIndex((item) => getKey(item) === scrollToKey) : -1
  // Scrolls once per key, so narrowing the list later does not pull it back into view.
  const scrolledTo = useRef<string>(undefined)
  useEffect(() => {
    if (target < 0 || scrolledTo.current === scrollToKey) return
    scrolledTo.current = scrollToKey
    virtualizer.scrollToIndex(target, { align: 'center' })
  }, [virtualizer, target, scrollToKey])

  return (
    <div className="@container overflow-hidden rounded-lg border bg-card">
      <ul ref={listRef} className="relative divide-y" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtual) => (
          <VirtualRow
            as="li"
            key={virtual.key}
            index={virtual.index}
            start={virtual.start - scrollMargin}
            measureElement={virtualizer.measureElement}
          >
            {renderItem(items[virtual.index])}
          </VirtualRow>
        ))}
      </ul>
    </div>
  )
}

function scrollParent(element: HTMLElement) {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent
  }
  return document.documentElement
}
