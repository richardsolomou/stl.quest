import { Check, ChevronRight, Plus, Settings2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/** A catalogue picker's card: the same hover border and focus ring in every picker. */
export const catalogueCard =
  'group flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-lg border border-border bg-field p-2.5 text-left shadow-xs transition-[border-color,box-shadow,background-color] hover:border-foreground/40 hover:shadow-md focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none'

/** The first card of a picker, for something the catalogue does not list. */
export function CustomCard({ title, description, onClick }: { title: string; description: string; onClick: () => void }) {
  return (
    <button type="button" className={cn(catalogueCard, 'p-3')} onClick={onClick}>
      <span className="flex size-14 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Settings2 className="size-6" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block font-medium">{title}</span>
        <span className="block text-sm text-muted-foreground">{description}</span>
      </span>
    </button>
  )
}

/** Marks a card as already added, or as the current choice. */
export function CardMark({ children }: { children: ReactNode }) {
  return (
    <Badge variant="secondary" className="shrink-0 text-[0.65rem]">
      <Check /> {children}
    </Badge>
  )
}

/** A card's trailing sign: + when it adds something, › when it changes something. */
export function CardAffordance({ changing }: { changing: boolean }) {
  const Icon = changing ? ChevronRight : Plus
  return <Icon className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden="true" />
}
