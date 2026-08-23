import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function VirtualRow({
  index,
  start,
  measureElement,
  children,
  className,
}: {
  index: number
  start: number
  measureElement: (element: HTMLDivElement | null) => void
  children: ReactNode
  className?: string
}) {
  const [transitionsEnabled, setTransitionsEnabled] = useState(false)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setTransitionsEnabled(true))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  return (
    <div
      className={cn(
        'virtual-row absolute top-0 left-0 w-full will-change-transform',
        transitionsEnabled && 'transition-[transform,opacity] duration-200 ease-out',
        className,
      )}
      data-index={index}
      ref={measureElement}
      style={{ transform: `translateY(${start}px)` }}
    >
      {children}
    </div>
  )
}
