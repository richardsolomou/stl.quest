import { Info } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { PublicPrintRequest } from '../../core/types'
import { estimatePending, formatEstimateMaterial, formatEstimateTime, requestPrintEstimate } from '../../core/printEstimates'
import { DetailRow } from './DetailRow'
import { useI18n, type I18n } from '../i18n'

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
  const estimateBasis =
    estimate.materialAdjusted || estimate.minutesAdjusted ? t.requests.estimate.adjusted : t.requests.estimate.approximated
  return (
    <DetailRow label={t.requests.estimate.label}>
      <section aria-label={t.requests.estimate.label} className="flex items-center gap-1.5">
        <span>
          <strong className="font-semibold">{parts.join(' · ')}</strong>{' '}
          <span className="text-muted-foreground">{t.requests.estimate.perCopy}</span>
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className="grid size-5 shrink-0 cursor-help place-items-center rounded-full text-muted-foreground hover:text-foreground"
                aria-label={estimateBasis}
              />
            }
          >
            <Info className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent className="max-w-64">{estimateBasis}</TooltipContent>
        </Tooltip>
      </section>
    </DetailRow>
  )
}
