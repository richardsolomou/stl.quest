import { CircleAlert, LoaderCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { estimateMaterialUsage, type MaterialEstimate } from '../../core/material'
import type { PrintType, PublicPrintRequest } from '../../core/types'
import { fitState, printTypeLabel } from '../fleet'

export { printTypeLabel }

export function PrintTypeBadge({ printType }: { printType: PrintType }) {
  return <Badge variant="outline">{printTypeLabel(printType)}</Badge>
}

export function materialEstimate(request: PublicPrintRequest, quantity = 1) {
  if (!request.printType) return undefined
  return estimateMaterialUsage({
    printType: request.printType,
    estimatedVolumeMm3: request.estimatedVolumeMm3,
    quantity,
    printer: request.printer,
    filamentAssumptions: request.filamentAssumptions,
  })
}

export function MaterialBadge({ request, quantity = 1 }: { request: PublicPrintRequest; quantity?: number }) {
  const estimate = materialEstimate(request, quantity)
  if (!estimate) return null
  return (
    <Badge variant="outline" className="font-mono text-muted-foreground" aria-label={materialAriaLabel(estimate)}>
      ≈{formatMaterial(estimate.total)} {estimate.unit}
    </Badge>
  )
}

export function MaterialDetails({ request }: { request: PublicPrintRequest }) {
  if (!request.printType) return null
  const estimate = materialEstimate(request, request.quantity)
  if (!estimate) {
    return (
      <p className="text-sm text-muted-foreground">
        {request.estimatedVolumeMm3 === undefined
          ? 'Material estimate is pending model analysis.'
          : request.printType === 'filament'
            ? 'Configure at least one filament printer, or align every enabled filament printer’s diameter and material density, to calculate a solid-equivalent estimate.'
            : 'A reliable enclosed model volume is unavailable, so material usage cannot be estimated.'}
      </p>
    )
  }
  return (
    <div className="rounded-lg border bg-muted/20 p-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <strong>
          ≈{formatMaterial(estimate.perCopy)} {estimate.unit} each
        </strong>
        {request.quantity > 1 && (
          <span className="text-muted-foreground">
            ≈{formatMaterial(estimate.total)} {estimate.unit} total
          </span>
        )}
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{estimate.assumption}</p>
      {estimate.printType === 'filament' && (
        <p className="mt-1 text-xs text-muted-foreground">Based on material density of {estimate.densityGPerCm3} g/cm³.</p>
      )}
    </div>
  )
}

export function DisabledPrinterBadge({ request }: { request: PublicPrintRequest }) {
  if (!request.printer || request.printer.enabled) return null
  return (
    <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">
      Assigned printer is disabled
    </Badge>
  )
}

export function FitBadge({ request }: { request: PublicPrintRequest }) {
  const fit = fitState(request)
  if (!fit) return null
  if (fit === 'pending') {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        <LoaderCircle className="animate-spin" /> Checking fit
      </Badge>
    )
  }
  if (fit === 'none') {
    return (
      <Badge variant="destructive">
        <CircleAlert /> Fits no enabled printer
      </Badge>
    )
  }
  if (fit === 'another_compatible_printer') {
    return (
      <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">
        <CircleAlert /> Assigned printer does not fit; another enabled printer does
      </Badge>
    )
  }
  return null
}

export function FitAlertIcon({ request }: { request: PublicPrintRequest }) {
  if (request.printer && !request.printer.enabled) {
    return (
      <span className="text-amber-600 dark:text-amber-300" aria-label="Assigned printer is disabled" title="Assigned printer is disabled">
        <CircleAlert className="size-4" aria-hidden="true" />
      </span>
    )
  }
  const fit = fitState(request)
  if (fit === 'pending') {
    return (
      <span className="text-muted-foreground" aria-label="Checking printer fit" title="Checking printer fit">
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
      </span>
    )
  }
  if (fit === 'none' || fit === 'another_compatible_printer') {
    const label = fit === 'none' ? 'Fits no enabled printer' : 'Assigned printer does not fit'
    return (
      <span className="text-destructive" aria-label={label} title={label}>
        <CircleAlert className="size-4" aria-hidden="true" />
      </span>
    )
  }
  return null
}

export function formatMaterial(value: number) {
  if (value >= 100) return Math.round(value).toString()
  if (value >= 10) return value.toFixed(1)
  return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function materialAriaLabel(estimate: MaterialEstimate) {
  return `Estimated material: ${formatMaterial(estimate.total)} ${estimate.unit}`
}
