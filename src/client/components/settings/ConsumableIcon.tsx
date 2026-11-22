import { FlaskConical, Package, Wrench, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { appPath } from '../../../basePath'
import type { Consumable } from '../../../core/consumables'

const ICONS: Record<Exclude<Consumable['kind'], 'filament'>, LucideIcon> = { resin: FlaskConical, supply: Package, part: Wrench }

/** A catalogue resin's product photo, a filament spool in its colour, or a quiet sign of what kind of consumable it is. */
export function ConsumableIcon({
  consumable,
  image,
  className,
}: {
  consumable: Pick<Consumable, 'kind'> & { colour?: { hex: string } }
  image?: { src: string }
  className?: string
}) {
  if (image) {
    return (
      <span
        className={cn('flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-white', className)}
        aria-hidden="true"
      >
        <img src={appPath(image.src)} alt="" className="size-full object-contain p-0.5" loading="lazy" />
      </span>
    )
  }
  const Icon = consumable.kind === 'filament' ? undefined : ICONS[consumable.kind]
  return (
    <span
      className={cn('flex size-10 shrink-0 items-center justify-center rounded-md border bg-muted/40 text-foreground/60', className)}
      aria-hidden="true"
    >
      {Icon ? <Icon className="size-[45%]" /> : <FilamentSpool hex={consumable.colour?.hex} />}
    </span>
  )
}

/** A spool seen face on, its winding in the filament's colour, or faint before one is chosen. */
function FilamentSpool({ hex }: { hex?: string }) {
  return (
    <svg viewBox="0 0 24 24" className="size-[70%]" fill="none" stroke="currentColor" strokeWidth="1.25">
      <circle cx="12" cy="12" r="10.5" />
      <circle cx="12" cy="12" r="8.25" fill={hex ?? 'currentColor'} fillOpacity={hex ? 1 : 0.12} strokeOpacity="0.5" />
      <circle cx="12" cy="12" r="6" stroke={hex ? '#000' : undefined} strokeOpacity={hex ? 0.2 : 0.4} strokeDasharray="1.5 1.5" />
      <circle cx="12" cy="12" r="3.25" className="fill-background" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}
