import { Spinner } from '@/components/ui/spinner'
import type { PublicPrintRequest } from '../../core/types'
import { formatEstimateMaterial, formatEstimateTime } from '../../core/printEstimates'
import { DetailRow } from './DetailRow'
import { useI18n, type I18n } from '../i18n'

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

function estimateParts(estimate: NonNullable<ReturnType<typeof requestPrintEstimate>>, { t, locale }: I18n) {
  return [
    estimate.material === undefined
      ? undefined
      : `${estimate.materialAdjusted ? '' : '≈'}${formatEstimateMaterial(estimate.material, locale)} ${estimate.materialUnit}`,
    estimate.minutes === undefined
      ? undefined
      : `${estimate.minutesAdjusted ? '' : '≈'}${formatEstimateTime(estimate.minutes, t.requests)}`,
  ].filter((part): part is string => part !== undefined)
}

export function printEstimateSummary(request: PublicPrintRequest, i18n: I18n) {
  const estimate = requestPrintEstimate(request)
  const parts = estimate ? estimateParts(estimate, i18n) : []
  return parts.length ? parts.join(' · ') : undefined
}

/** The geometry a fresh or replaced model still owes, so the missing estimate reads as pending rather than absent. */
function estimatePending(request: PublicPrintRequest) {
  return request.estimateGeometryStatus === 'pending' || request.estimateGeometryStatus === 'running'
}

export function PrintEstimateBadges({ request }: { request: PublicPrintRequest }) {
  const i18n = useI18n()
  const { t } = i18n
  const estimate = requestPrintEstimate(request)
  if (!estimate || (estimate.material === undefined && estimate.minutes === undefined)) {
    if (!estimatePending(request)) return null
    return (
      <span className="mt-0.5 block truncate font-mono text-xs text-ticket-muted/70 max-[620px]:whitespace-normal">
        {t.requests.estimate.workingOutShort}
      </span>
    )
  }
  const parts = estimateParts(estimate, i18n)
  return (
    <span className="mt-0.5 block truncate font-mono text-xs text-ticket-muted/70 max-[620px]:whitespace-normal" title={parts.join(' · ')}>
      {parts.join(' · ')}
    </span>
  )
}

export function PrintEstimateDetails({ request }: { request: PublicPrintRequest }) {
  const i18n = useI18n()
  const { t } = i18n
  const estimate = requestPrintEstimate(request)
  if (!estimate || (estimate.material === undefined && estimate.minutes === undefined)) {
    if (!estimatePending(request)) return null
    return (
      <DetailRow label={t.requests.estimate.label}>
        <section aria-label={t.requests.estimate.label} className="flex items-center gap-2 text-muted-foreground">
          <Spinner className="size-3.5" /> {t.requests.estimate.workingOut}
        </section>
      </DetailRow>
    )
  }
  const parts = estimateParts(estimate, i18n)
  return (
    <DetailRow label={t.requests.estimate.label}>
      <section aria-label={t.requests.estimate.label}>
        <strong>{parts.join(' · ')}</strong> <span className="text-muted-foreground">{t.requests.estimate.perCopy}</span>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {estimate.materialAdjusted || estimate.minutesAdjusted ? t.requests.estimate.adjusted : t.requests.estimate.approximated}
        </p>
      </section>
    </DetailRow>
  )
}
