import type { PublicPrintRequest } from '../../core/types'
import { formatEstimateMaterial, formatEstimateTime } from '../../core/printEstimates'

export function requestPrintEstimate(request: PublicPrintRequest) {
  if (!request.printType) return undefined
  return {
    material: request.estimatedMaterialOverride ?? request.automaticEstimatedMaterial,
    materialUnit: request.estimatedMaterialUnit ?? (request.printType === 'resin' ? 'ml' : 'g'),
    minutes: request.estimatedPrintMinutesOverride ?? request.automaticEstimatedPrintMinutes,
    materialAdjusted: request.estimatedMaterialOverride !== undefined,
    minutesAdjusted: request.estimatedPrintMinutesOverride !== undefined,
  }
}

export function PrintEstimateBadges({ request }: { request: PublicPrintRequest }) {
  const estimate = requestPrintEstimate(request)
  if (!estimate || (estimate.material === undefined && estimate.minutes === undefined)) return null
  const parts = [
    estimate.material === undefined
      ? undefined
      : `${estimate.materialAdjusted ? '' : '≈'}${formatEstimateMaterial(estimate.material)} ${estimate.materialUnit}`,
    estimate.minutes === undefined ? undefined : `${estimate.minutesAdjusted ? '' : '≈'}${formatEstimateTime(estimate.minutes)}`,
  ].filter((part): part is string => part !== undefined)
  return (
    <span className="mt-0.5 block truncate font-mono text-xs text-ticket-muted/70" title={parts.join(' · ')}>
      {parts.join(' · ')}
    </span>
  )
}

export function PrintEstimateDetails({ request }: { request: PublicPrintRequest }) {
  const estimate = requestPrintEstimate(request)
  if (!estimate || (estimate.material === undefined && estimate.minutes === undefined)) return null
  const parts = [
    estimate.material === undefined
      ? undefined
      : `${estimate.materialAdjusted ? '' : '≈'}${formatEstimateMaterial(estimate.material)} ${estimate.materialUnit}`,
    estimate.minutes === undefined ? undefined : `${estimate.minutesAdjusted ? '' : '≈'}${formatEstimateTime(estimate.minutes)}`,
  ].filter((part): part is string => part !== undefined)
  return (
    <div className="mb-3">
      <div className="mb-1 text-xs text-muted-foreground">Estimate</div>
      <p className="text-sm">
        <strong>{parts.join(' · ')}</strong> <span className="text-muted-foreground">per copy</span>
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {estimate.materialAdjusted || estimate.minutesAdjusted
          ? 'Adjusted values replace the automatic estimate.'
          : 'Approximated from model geometry and typical print settings; slicing may differ.'}
      </p>
    </div>
  )
}
