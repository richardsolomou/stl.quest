import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Info } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SPEND_CATEGORIES, summariseSpend, usageSteps } from '../../core/spend'
import { usageCost } from '../../core/usage'
import { useI18n } from '../i18n'
import { consumablesQuery, equipmentQuery, priceCalculatorSettingsQuery, printersQuery, usageQuery } from '../queries'
import { useWorkspaceSlug } from '../workspace'
import { DetailRow } from './DetailRow'
import { formatMoney } from './priceCalculator/format'
import { formatUsageAmount, usedItemName } from './spend/format'

/** Admin-only, like the estimate: what this print has used so far, each step at the prices it was recorded at. */
export function RequestActualCost({ requestId, people }: { requestId: string; people: { id: string; name: string }[] }) {
  const { t, locale } = useI18n()
  const copy = t.spend
  const workspaceSlug = useWorkspaceSlug()
  const events = useQuery(usageQuery(workspaceSlug, { requestId })).data?.events
  const settings = useQuery(priceCalculatorSettingsQuery(workspaceSlug)).data?.settings
  const library = {
    consumables: useQuery(consumablesQuery(workspaceSlug)).data?.consumables ?? [],
    equipment: useQuery(equipmentQuery(workspaceSlug)).data?.equipment ?? [],
    printers: useQuery(printersQuery(workspaceSlug)).data?.profiles ?? [],
  }
  if (!events || !settings) return null
  const steps = usageSteps(events)
  if (!steps.length) return null
  const summary = summariseSpend(events, library.consumables, settings.currency)
  const money = (value: number, currency = settings.currency) => formatMoney(value, currency, locale)
  const used = new Set(summary.items.map(({ category }) => category))
  const stepTime = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return (
    <DetailRow label={copy.print.label}>
      <span className="flex items-start gap-1.5">
        <span className="min-w-0">
          <strong className="font-semibold">{money(summary.total)}</strong>
          <span className="text-muted-foreground"> {copy.print.soFar}</span>
          {summary.otherCurrencies.map((other) => (
            <span key={other.currency} className="block text-xs text-muted-foreground">
              {copy.otherCurrency(money(other.total, other.currency), other.currency)}
            </span>
          ))}
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className="mt-0.5 grid size-5 shrink-0 cursor-help place-items-center rounded-full text-muted-foreground hover:text-foreground"
                aria-label={copy.print.hint}
              />
            }
          >
            <Info className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent className="max-w-64">{copy.print.hint}</TooltipContent>
        </Tooltip>
      </span>
      <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-xs">
        {SPEND_CATEGORIES.filter((category) => used.has(category)).map((category) => (
          <div key={category} className="contents">
            <dt className="text-muted-foreground">{copy.categories[category]}</dt>
            <dd className="text-right font-mono tabular-nums">{money(summary.categories[category])}</dd>
          </div>
        ))}
        {summary.outcomes.failed > 0 && (
          <div className="contents">
            <dt className="text-destructive">{copy.outcomes.failed}</dt>
            <dd className="text-right font-mono text-destructive tabular-nums">{money(summary.outcomes.failed)}</dd>
          </div>
        )}
      </dl>
      <details className="group mt-1.5 text-xs">
        <summary className="flex cursor-pointer list-none items-center gap-1 text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-3.5 shrink-0 transition-transform group-open:rotate-90" />
          {copy.print.steps(steps.length)}
        </summary>
        <ol className="mt-1.5 flex flex-col gap-2.5 sm:pl-5">
          {steps.map((step) => (
            <li key={step.transactionId} className="flex flex-col gap-1">
              <div className="flex items-baseline gap-2">
                <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="font-heading font-bold tracking-[0.015em] uppercase">{copy.print.stage[step.stage]}</span>
                  {step.copies !== undefined && <span className="text-muted-foreground">{copy.print.copies(step.copies)}</span>}
                  {step.failed && (
                    <Badge variant="destructive" className="h-4 self-center rounded-[4px] px-1.5">
                      {copy.print.failed}
                    </Badge>
                  )}
                </span>
                <span className="font-mono font-medium tabular-nums">{money(step.cost, step.currency)}</span>
              </div>
              <p className="text-muted-foreground">
                {people.find(({ id }) => id === step.userId)?.name ?? copy.print.someone} ·{' '}
                <time dateTime={new Date(step.createdAt).toISOString()}>{stepTime.format(step.createdAt)}</time>
              </p>
              <dl className="flex flex-col gap-0.5">
                {step.events.map((event) => (
                  <div key={event.id} className="flex items-baseline gap-3">
                    <dt className="min-w-0 flex-1 break-words">
                      {usedItemName(event, library) ?? copy.print.removed}{' '}
                      <span className="whitespace-nowrap text-muted-foreground tabular-nums">
                        · {formatUsageAmount(event.amount, event.unit, copy, locale)}
                      </span>
                    </dt>
                    <dd className="font-mono tabular-nums">
                      {event.unitPrice === undefined ? '—' : money(usageCost(event), event.currency)}
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ol>
      </details>
    </DetailRow>
  )
}
