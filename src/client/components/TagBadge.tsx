import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { PrintGroupColor } from '../../core/types'

const MAX_VISIBLE_TAG_DOTS = 6

const tagColorClass: Record<PrintGroupColor, string> = {
  blue: 'bg-blue-500',
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  violet: 'bg-violet-500',
  rose: 'bg-rose-500',
  cyan: 'bg-cyan-500',
  orange: 'bg-orange-500',
  lime: 'bg-lime-500',
  fuchsia: 'bg-fuchsia-500',
  sky: 'bg-sky-500',
  teal: 'bg-teal-500',
  indigo: 'bg-indigo-500',
}

export function TagDot({ color, className }: { color: PrintGroupColor; className?: string }) {
  return <span aria-hidden="true" className={cn('inline-block size-2 shrink-0 rounded-full', tagColorClass[color], className)} />
}

/**
 * A card's tags are usually long, so listing them as chips ate more space than the print's own name
 * or thumbnail. This shows only each tag's colour as a small dot; hovering one reveals its full path.
 */
export function TagDotCluster({
  tags,
  draggable: canDrag = false,
  activeTagId,
  className,
}: {
  tags: { id: string; color: PrintGroupColor; path: string; count: number }[]
  draggable?: boolean
  activeTagId?: string
  className?: string
}) {
  if (tags.length === 0) return null
  const visible = tags.slice(0, MAX_VISIBLE_TAG_DOTS)
  const overflow = tags.length - visible.length
  return (
    <div className={cn('absolute bottom-1 left-1 z-1 flex items-center gap-1', className)}>
      {visible.map((tag) => (
        <DraggableTagDot key={tag.id} tag={tag} canDrag={canDrag} active={activeTagId === tag.id} />
      ))}
      {overflow > 0 && (
        <span
          className="rounded-full bg-foreground/70 px-1 font-mono text-[9px] leading-4 text-background"
          title={`${overflow} more ${overflow === 1 ? 'tag' : 'tags'}`}
        >
          +{overflow}
        </span>
      )}
    </div>
  )
}

function DraggableTagDot({
  tag,
  canDrag,
  active,
}: {
  tag: { id: string; color: PrintGroupColor; path: string; count: number }
  canDrag: boolean
  active: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            data-tag-dot={tag.path}
            data-tag-id={tag.id}
            data-tag-copy-count={tag.count}
            aria-label={`${tag.path}, ${tag.count} ${tag.count === 1 ? 'copy' : 'copies'}`}
            className={cn(
              'group/tag inline-flex max-w-40 items-center gap-1 overflow-hidden rounded-full bg-ticket px-0.5 py-0.5 ring-2 ring-ticket transition-[background-color,color,box-shadow]',
              canDrag && 'cursor-grab touch-manipulation',
              canDrag && 'hover:bg-primary hover:text-primary-foreground hover:shadow-sm',
              active && 'bg-primary text-primary-foreground shadow-sm',
            )}
          />
        }
      >
        <TagDot color={tag.color} />
        <span
          className={cn(
            'max-w-0 truncate font-sans text-[11px] font-semibold whitespace-nowrap opacity-0 transition-[max-width,opacity] duration-150 group-hover/tag:max-w-32 group-hover/tag:opacity-100',
            active && 'max-w-32 opacity-100',
          )}
        >
          {tag.path} · {tag.count}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {tag.path} · {tag.count} {tag.count === 1 ? 'copy' : 'copies'}
      </TooltipContent>
    </Tooltip>
  )
}

/** A tag inside a flattened hierarchical list: indentation implies nesting instead of restating every ancestor's name. */
export function TagTreeRow({ depth, color, name, className }: { depth: number; color: PrintGroupColor; name: string; className?: string }) {
  return (
    <span className={cn('flex min-w-0 items-center gap-2', className)} style={{ paddingInlineStart: Math.min(depth, 4) * 16 }}>
      <TagDot color={color} />
      <span className="truncate">{name}</span>
    </span>
  )
}
