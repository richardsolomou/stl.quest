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
    <span className="block truncate font-mono text-xs text-ticket-muted" title={parts.join(' · ')}>
      {parts.join(' · ')}
    </span>
  )
}

export function PrintEstimateDetails({ request }: { request: PublicPrintRequest }) {
  const estimate = requestPrintEstimate(request)
  if (!estimate || (estimate.material === undefined && estimate.minutes === undefined)) return null
  return (
    <div className="mb-3 rounded-lg border bg-muted/20 p-3 text-sm">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {estimate.material !== undefined && (
          <strong>
            {estimate.materialAdjusted ? '' : '≈'}
            {formatEstimateMaterial(estimate.material)} {estimate.materialUnit} per copy
          </strong>
        )}
        {estimate.minutes !== undefined && (
          <strong>
            {estimate.minutesAdjusted ? '' : '≈'}
            {formatEstimateTime(estimate.minutes)} per copy
          </strong>
        )}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {estimate.materialAdjusted || estimate.minutesAdjusted
          ? 'Adjusted values replace the automatic estimate.'
          : 'Approximation from model geometry and typical print settings; slicing may differ.'}
      </p>
    </div>
  )
}
