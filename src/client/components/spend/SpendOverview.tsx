import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ReceiptText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { cn } from '@/lib/utils'
import {
  dayString,
  SPEND_CATEGORIES,
  SPEND_OUTCOMES,
  SPEND_PERIODS,
  spendPeriod,
  spendTrend,
  summariseSpend,
  type SpendCategory,
  type SpendItem,
  type SpendOutcome,
  type SpendPeriodPreset,
} from '../../../core/spend'
import { useI18n } from '../../i18n'
import {
  consumablesQuery,
  equipmentQuery,
  priceCalculatorSettingsQuery,
  printersQuery,
  requestsQuery,
  usagePeriodQuery,
  usageQuery,
} from '../../queries'
import { CalculatorTabs } from '../priceCalculator/CalculatorTabs'
import { formatMoney, formatNumber } from '../priceCalculator/format'
import { QueryState } from '../QueryState'
import { Docket, PageHeader, SettingsPage } from '../settings/SettingsLayout'
import { formatUsageAmount, usedItemName, type UsageLibrary } from './format'
import { SpendTrendChart } from './SpendTrendChart'

export type SpendSearch = { period?: SpendPeriodPreset; from?: string; to?: string }

const OUTCOME_FILL: Record<SpendOutcome, string> = { used: 'bg-chart-1', failed: 'bg-chart-2', wasted: 'bg-chart-3' }
const LIST_LIMIT = 8

export function SpendOverview({
  workspaceSlug,
  search,
  onSearchChange,
}: {
  workspaceSlug: string
  search: SpendSearch
  onSearchChange: (search: SpendSearch) => void
}) {
  const { t, locale } = useI18n()
  const copy = t.spend
  const now = useMemo(() => Date.now(), [])
  const preset = search.period ?? 'month'
  const period = spendPeriod(preset, now, search)
  const settings = useQuery(priceCalculatorSettingsQuery(workspaceSlug))
  const usage = useQuery(usagePeriodQuery(workspaceSlug, period))
  const anything = useQuery(usageQuery(workspaceSlug, { limit: 1 }))
  const library = {
    consumables: useQuery(consumablesQuery(workspaceSlug)).data?.consumables ?? [],
    equipment: useQuery(equipmentQuery(workspaceSlug)).data?.equipment ?? [],
    printers: useQuery(printersQuery(workspaceSlug)).data?.profiles ?? [],
  }
  const active = useQuery(requestsQuery(workspaceSlug)).data?.requests ?? []
  const archived = useQuery(requestsQuery(workspaceSlug, { archived: true })).data?.requests ?? []
  const choosePreset = (next: SpendPeriodPreset) =>
    onSearchChange(next === 'custom' ? { period: next, from: dayString(period.from), to: dayString(period.to - 1) } : { period: next })
  const header = (
    <>
      <PageHeader title={copy.title} description={copy.description} actions={<CalculatorTabs active="spend" />} />
      <div className="-mt-3 flex flex-wrap items-end gap-3">
        <SegmentedControl
          legend={copy.period.legend}
          value={preset}
          options={SPEND_PERIODS.map((value) => ({ value, label: copy.period[value] }))}
          onChange={choosePreset}
          className="grid w-full grid-cols-2 sm:flex sm:w-auto [&>button]:px-3"
        />
        {preset === 'custom' && (
          <div className="flex flex-wrap items-end gap-3">
            {(['from', 'to'] as const).map((edge) => (
              <label key={edge} className="flex flex-col gap-1 text-xs font-medium">
                {copy.period[edge]}
                <Input
                  type="date"
                  className="w-40"
                  value={search[edge] ?? dayString(edge === 'from' ? period.from : period.to - 1)}
                  onChange={(event) => event.target.value && onSearchChange({ ...search, period: 'custom', [edge]: event.target.value })}
                />
              </label>
            ))}
          </div>
        )}
      </div>
    </>
  )

  const failed = settings.error ?? usage.error ?? anything.error
  if (!settings.data || !usage.data || !anything.data) {
    return (
      <SettingsPage>
        {header}
        <QueryState
          loading={!failed}
          error={failed}
          loadingLabel={copy.loading}
          errorTitle={copy.loadError}
          onRetry={() => void Promise.all([settings.refetch(), usage.refetch(), anything.refetch()])}
        />
      </SettingsPage>
    )
  }

  const currency = settings.data.settings.currency
  const money = (value: number) => formatMoney(value, currency, locale)
  if (anything.data.events.length === 0) {
    return (
      <SettingsPage>
        {header}
        <Empty className="border border-border bg-card py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ReceiptText />
            </EmptyMedia>
            <EmptyTitle className="text-base font-bold uppercase">{copy.empty.title}</EmptyTitle>
            <EmptyDescription>{copy.empty.description}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Link
              to="/"
              className="text-sm font-medium text-foreground underline decoration-primary decoration-2 underline-offset-4 hover:decoration-foreground"
            >
              {copy.empty.openBoard}
            </Link>
          </EmptyContent>
        </Empty>
      </SettingsPage>
    )
  }

  const events = usage.data.events
  const summary = summariseSpend(events, library.consumables, currency)
  const share = (value: number) => (summary.total > 0 ? formatNumber((value / summary.total) * 100, locale, 0) + '%' : '0%')
  const requests = new Map([...active, ...archived].map((request) => [request.id, request.name]))
  return (
    <SettingsPage>
      {header}
      <div className={cn('flex min-w-0 flex-col gap-6 transition-opacity', usage.isPlaceholderData && 'opacity-60')}>
        {events.length === 0 ? (
          <Empty className="border border-dashed border-border py-10">
            <EmptyHeader>
              <EmptyTitle className="text-base font-bold uppercase">{copy.empty.periodTitle}</EmptyTitle>
              <EmptyDescription>{copy.empty.periodDescription}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border lg:grid-cols-4">
              <Stat label={copy.totals.total} className="col-span-2 lg:col-span-1">
                <span className="text-5xl leading-none font-semibold">{money(summary.total)}</span>
              </Stat>
              <Stat
                label={copy.totals.prints}
                note={summary.prints.length ? copy.totals.perPrint(money(summary.total / summary.prints.length)) : undefined}
              >
                {formatNumber(summary.prints.length, locale)}
              </Stat>
              <Stat label={copy.totals.failed} note={copy.totals.share(share(summary.outcomes.failed))}>
                {money(summary.outcomes.failed)}
              </Stat>
              <Stat
                label={copy.totals.wasted}
                note={copy.totals.share(share(summary.outcomes.wasted))}
                className="col-span-2 lg:col-span-1"
              >
                {money(summary.outcomes.wasted)}
              </Stat>
            </dl>
            {(summary.unpriced > 0 || summary.otherCurrencies.length > 0) && (
              <div className="-mt-3 flex flex-col gap-1 text-xs text-muted-foreground">
                {summary.unpriced > 0 && (
                  <p>
                    {copy.unpriced(summary.unpriced)}{' '}
                    <Link
                      to="/settings/$section"
                      params={{ section: 'consumables' }}
                      className="font-medium text-foreground underline decoration-primary decoration-2 underline-offset-4"
                    >
                      {copy.consumablesLink}
                    </Link>
                    .
                  </p>
                )}
                {summary.otherCurrencies.map((other) => (
                  <p key={other.currency}>{copy.otherCurrency(formatMoney(other.total, other.currency, locale), other.currency)}</p>
                ))}
              </div>
            )}
            <Docket title={copy.trend.title}>
              <SpendTrendChart buckets={spendTrend(events, period, currency)} currency={currency} />
            </Docket>
            <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-2">
              <Docket title={copy.categories.title}>
                <ul className="flex flex-col gap-3">
                  {[...SPEND_CATEGORIES]
                    .sort((a, b) => summary.categories[b] - summary.categories[a])
                    .map((category) => (
                      <MeterRow
                        key={category}
                        name={copy.categories[category]}
                        hint={categoryHint(category, copy.categories)}
                        value={money(summary.categories[category])}
                        share={summary.total > 0 ? summary.categories[category] / summary.total : 0}
                      />
                    ))}
                </ul>
              </Docket>
              <Docket title={copy.outcomes.title}>
                <div className="flex h-2 gap-0.5" aria-hidden="true">
                  {SPEND_OUTCOMES.filter((outcome) => summary.outcomes[outcome] > 0).map((outcome) => (
                    <span
                      key={outcome}
                      className={cn('rounded-full', OUTCOME_FILL[outcome])}
                      style={{ flexGrow: summary.outcomes[outcome], flexBasis: 0 }}
                    />
                  ))}
                </div>
                <ul className="flex flex-col">
                  {SPEND_OUTCOMES.map((outcome) => (
                    <li key={outcome} className="flex items-baseline gap-2 border-b border-border py-2 text-sm last:border-0">
                      <span aria-hidden="true" className={cn('size-2.5 shrink-0 self-center rounded-[3px]', OUTCOME_FILL[outcome])} />
                      <span className="min-w-0 flex-1">{copy.outcomes[outcome]}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{share(summary.outcomes[outcome])}</span>
                      <span className="w-24 text-right font-mono tabular-nums">{money(summary.outcomes[outcome])}</span>
                    </li>
                  ))}
                </ul>
              </Docket>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-2">
              <Docket title={copy.items.title}>
                <ItemTable items={summary.items} library={library} money={money} />
              </Docket>
              <Docket title={copy.prints.title}>
                <PrintList prints={summary.prints} names={requests} money={money} />
              </Docket>
            </div>
          </>
        )}
      </div>
    </SettingsPage>
  )
}

function ItemTable({ items, library, money }: { items: SpendItem[]; library: UsageLibrary; money: (value: number) => string }) {
  const { t, locale } = useI18n()
  const copy = t.spend
  const { shown, more } = useCapped(items)
  return (
    <div className="flex flex-col gap-2">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="w-full py-1.5 font-medium">{copy.items.name}</th>
            <th className="py-1.5 pl-3 text-right font-medium max-sm:hidden">{copy.items.used}</th>
            <th className="py-1.5 pl-3 text-right font-medium">{copy.items.cost}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((item) => {
            const name = usedItemName(
              item.category === 'printer'
                ? { printerId: item.id }
                : item.category === 'equipment'
                  ? { equipmentId: item.id }
                  : { consumableId: item.id },
              library,
            )
            return (
              <tr key={`${item.category}:${item.id}:${item.unit}`} className="border-b border-border/60 last:border-0">
                <td className="max-w-0 py-1.5">
                  <span className={cn('block truncate', !name && 'text-muted-foreground italic')}>{name ?? copy.items.removed}</span>
                  <span className="block text-xs text-muted-foreground">
                    {copy.categories[item.category]}
                    {/* On phones the amount joins this line, so the name keeps the width. */}
                    <span className="tabular-nums sm:hidden"> · {formatUsageAmount(item.amount, item.unit, copy, locale)}</span>
                  </span>
                </td>
                <td className="py-1.5 pl-3 text-right whitespace-nowrap text-muted-foreground tabular-nums max-sm:hidden">
                  {formatUsageAmount(item.amount, item.unit, copy, locale)}
                </td>
                <td className="py-1.5 pl-3 text-right font-mono whitespace-nowrap tabular-nums">{money(item.cost)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {more}
    </div>
  )
}

function categoryHint(category: SpendCategory, copy: { printerHint: string; equipmentHint: string; partHint: string }) {
  if (category === 'printer') return copy.printerHint
  if (category === 'equipment') return copy.equipmentHint
  if (category === 'part') return copy.partHint
  return undefined
}

function Stat({ label, note, className, children }: { label: string; note?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-2 bg-card px-4 py-4 sm:px-5', className)}>
      <dt className="font-heading text-xs font-bold tracking-[0.015em] text-muted-foreground uppercase">{label}</dt>
      <dd className="text-2xl leading-none font-semibold">{children}</dd>
      {note && <dd className="text-xs text-muted-foreground">{note}</dd>}
    </div>
  )
}

function MeterRow({ name, hint, value, share }: { name: string; hint?: string; value: string; share: number }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1">
      <span className="min-w-0 text-sm">
        {name}
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <span className="font-mono text-sm tabular-nums">{value}</span>
      <span aria-hidden="true" className="col-span-2 h-2 overflow-hidden rounded-full bg-muted">
        <span className="block h-full rounded-full bg-chart-1" style={{ width: `${Math.round(share * 1000) / 10}%` }} />
      </span>
    </li>
  )
}

function PrintList({
  prints,
  names,
  money,
}: {
  prints: { requestId: string; cost: number; failed: boolean }[]
  names: Map<string, string>
  money: (value: number) => string
}) {
  const { t } = useI18n()
  const copy = t.spend.prints
  const { shown, more } = useCapped(prints)
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col">
        {shown.map((print) => {
          const name = names.get(print.requestId)
          return (
            <li key={print.requestId} className="flex items-baseline gap-2 border-b border-border/60 py-1.5 text-sm last:border-0">
              <span className={cn('min-w-0 flex-1 truncate', !name && 'text-muted-foreground italic')}>{name ?? copy.removed}</span>
              {print.failed && (
                <Badge variant="destructive" className="h-4 rounded-[4px] px-1.5">
                  {copy.failed}
                </Badge>
              )}
              <span className="font-mono tabular-nums">{money(print.cost)}</span>
            </li>
          )
        })}
      </ul>
      {more}
    </div>
  )
}

/** The first few of a long list, with a button that shows the rest. */
function useCapped<Item>(items: Item[]) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const hidden = expanded ? 0 : Math.max(0, items.length - LIST_LIMIT)
  return {
    shown: hidden ? items.slice(0, LIST_LIMIT) : items,
    more: hidden > 0 && (
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setExpanded(true)}>
        {t.spend.more(hidden)}
      </Button>
    ),
  }
}
