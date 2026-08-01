import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { PrintGroupColor } from '../../core/types'

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
  return <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', tagColorClass[color], className)} />
}

/** Shows the leaf name because nesting is already implied by the board, with the full path on hover. */
export function TagBadge({ name, color, detail, className }: { name: string; color: PrintGroupColor; detail: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge variant="outline" className={cn('max-w-full gap-1.5 border-current/15 font-normal', className)}>
            <TagDot color={color} />
            <span className="truncate">{name}</span>
          </Badge>
        }
      />
      <TooltipContent>{detail}</TooltipContent>
    </Tooltip>
  )
}
