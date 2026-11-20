import { AudioWaveform, Droplets, Heater, Sun, WashingMachine, Wind, Wrench, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { appPath } from '../../../basePath'
import type { EquipmentKind } from '../../../core/equipment'

const ICONS: Record<EquipmentKind, LucideIcon> = {
  wash: Droplets,
  cure: Sun,
  'wash-cure': WashingMachine,
  oven: Heater,
  ultrasonic: AudioWaveform,
  dryer: Wind,
  other: Wrench,
}

/** The catalogue model's product photo, or for custom kit and models without one, what kind of kit it is. */
export function EquipmentIcon({ kind, image, className }: { kind: EquipmentKind; image?: { src: string }; className?: string }) {
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
  const Icon = ICONS[kind]
  return (
    <span
      className={cn('flex size-10 shrink-0 items-center justify-center rounded-md border bg-muted/40 text-foreground/75', className)}
      aria-hidden="true"
    >
      <Icon className="size-1/2" />
    </span>
  )
}
