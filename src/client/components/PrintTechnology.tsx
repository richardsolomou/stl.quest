import { CircleAlert, LoaderCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { estimateMaterialUsage, type MaterialEstimate } from '../../core/material'
import type { PrintTechnology, PublicPrintRequest } from '../../core/types'

type FitState = 'pending' | 'selected_printer' | 'another_compatible_printer' | 'none'

export function technologyLabel(technology: PrintTechnology) {
  return technology === 'resin' ? 'Resin' : 'FDM'
}

export function TechnologyBadge({ technology }: { technology: PrintTechnology }) {
  return <Badge variant="outline">{technologyLabel(technology)}</Badge>
}

export function materialEstimate(request: PublicPrintRequest, quantity = 1) {
  return estimateMaterialUsage({
    technology: request.technology,
    estimatedVolumeMm3: request.estimatedVolumeMm3,
    quantity,
    printer: request.printer,
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
  const estimate = materialEstimate(request, request.quantity)
  if (!estimate) {
    return (
      <p className="text-sm text-muted-foreground">
        {request.estimatedVolumeMm3 === undefined
          ? 'Material estimate is pending model analysis.'
          : request.technology === 'fdm'
            ? 'Assign an FDM printer with filament diameter and material density to calculate a solid-equivalent estimate.'
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
        {estimate.technology === 'fdm' && (
          <span className="text-muted-foreground">≈{formatFilament(estimate.filamentMetersPerCopy)} m filament each</span>
        )}
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{estimate.assumption}</p>
      {estimate.technology === 'fdm' && (
        <p className="mt-1 text-xs text-muted-foreground">
          Based on {estimate.filamentDiameterMm} mm filament at {estimate.densityGPerCm3} g/cm³.
        </p>
      )}
    </div>
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
        <CircleAlert /> Fits no configured printer
      </Badge>
    )
  }
  if (fit === 'another_compatible_printer') {
    return (
      <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">
        <CircleAlert /> Assigned printer does not fit; another configured printer does
      </Badge>
    )
  }
  return null
}

export function FitAlertIcon({ request }: { request: PublicPrintRequest }) {
  const fit = fitState(request)
  if (fit === 'pending') {
    return (
      <span className="text-muted-foreground" aria-label="Checking printer fit" title="Checking printer fit">
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
      </span>
    )
  }
  if (fit === 'none' || fit === 'another_compatible_printer') {
    const label = fit === 'none' ? 'Fits no configured printer' : 'Assigned printer does not fit'
    return (
      <span className="text-destructive" aria-label={label} title={label}>
        <CircleAlert className="size-4" aria-hidden="true" />
      </span>
    )
  }
  return null
}

export function fitState(request: PublicPrintRequest): FitState | undefined {
  if (request.fitState) return request.fitState
  if (request.compatiblePrinterIds?.length === 0) return 'none'
  if (request.compatiblePrinterIds?.length) {
    return request.printerId && request.compatiblePrinterIds.includes(request.printerId) ? 'selected_printer' : 'another_compatible_printer'
  }
  return undefined
}

export function formatMaterial(value: number) {
  if (value >= 100) return Math.round(value).toString()
  if (value >= 10) return value.toFixed(1)
  return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function formatFilament(value: number) {
  return value >= 10 ? value.toFixed(1) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function materialAriaLabel(estimate: MaterialEstimate) {
  return `Approximately ${formatMaterial(estimate.total)} ${estimate.unit}. ${estimate.assumption}`
}
