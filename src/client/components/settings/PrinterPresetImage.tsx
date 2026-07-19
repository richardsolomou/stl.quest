import { cn } from '@/lib/utils'
import type { PrinterPreset } from '../../../core/printerPresets'

type PrinterVisual = Pick<PrinterPreset, 'image' | 'printType' | 'widthMm'>

export function PrinterPresetImage({ printer, className }: { printer: PrinterVisual; className?: string }) {
  if (printer.image) {
    return (
      <span
        className={cn('flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted', className)}
        aria-hidden="true"
      >
        <img src={printer.image.src} alt="" className="size-full object-contain p-1" loading="lazy" />
      </span>
    )
  }
  const resin = printer.printType === 'resin'
  const large = resin && printer.widthMm >= 250
  return (
    <span
      className={cn('flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted', className)}
      aria-hidden="true"
    >
      <svg viewBox="0 0 64 64" className="size-4/5 text-foreground/75" fill="none" stroke="currentColor" strokeWidth="2">
        {resin ? (
          <>
            <path d={large ? 'M14 47h36l-3-30H17l-3 30Z' : 'M17 47h30l-3-30H20l-3 30Z'} fill="currentColor" fillOpacity="0.08" />
            <path d="M20 25h24M22 32h20M15 47h34v5H15z" />
            <path d="M27 12h10l2 5H25l2-5Z" fill="currentColor" fillOpacity="0.16" />
          </>
        ) : (
          <>
            <path d="M14 53h36M18 50V14h28v36M18 19h28M32 19v22M27 41h10M22 49h20" />
            <path d="M25 44h14l3 5H22l3-5Z" fill="currentColor" fillOpacity="0.12" />
          </>
        )}
      </svg>
    </span>
  )
}
