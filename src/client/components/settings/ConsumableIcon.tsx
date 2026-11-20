import { FlaskConical, Package, Spool, Wrench, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Consumable } from '../../../core/consumables'
import { ColourSwatch } from '../ColourSwatch'

const ICONS: Record<Consumable['kind'], LucideIcon> = { resin: FlaskConical, filament: Spool, supply: Package, part: Wrench }

/** A filament's colour, or a quiet sign of what kind of consumable it is. */
export function ConsumableIcon({
  consumable,
  className,
}: {
  consumable: Pick<Consumable, 'kind'> & { colour?: { hex: string } }
  className?: string
}) {
  const Icon = ICONS[consumable.kind]
  return (
    <span
      className={cn('flex size-10 shrink-0 items-center justify-center rounded-md border bg-muted/40 text-foreground/60', className)}
      aria-hidden="true"
    >
      {consumable.colour ? (
        <ColourSwatch hex={consumable.colour.hex} className="size-1/2 border-foreground/35" />
      ) : (
        <Icon className="size-[45%]" />
      )}
    </span>
  )
}
