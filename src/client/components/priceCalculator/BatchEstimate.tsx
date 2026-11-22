import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, Copy } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Consumable } from '../../../core/consumables'
import { defaultFinishing, type EquipmentItem } from '../../../core/equipment'
import { costBasis, priceRequest, roundQuote, type PriceCalculatorSettings } from '../../../core/priceCalculator'
import type { PrinterRunCount } from '../../../core/printJobs'
import type { PrinterProfile, PrintType, PublicPrintRequest } from '../../../core/types'
import { useI18n } from '../../i18n'
import { requestsQuery } from '../../queries'
import { useWorkspaceSlug } from '../../workspace'
import { CopyButtonLabel, useCopied } from '../useCopied'
import { printEstimateSummary } from '../PrintEstimate'
import { requestPrintEstimate } from '../../../core/printEstimates'
import { QueryState } from '../QueryState'
import { RequestThumb } from '../RequestThumb'
import { Docket, PageHeader, SettingsPage } from '../settings/SettingsLayout'
import { CostBasisList, type CostBasisEntry } from './CostBasis'
import { formatMoney } from './format'
import { RatesLink } from './PricingSections'

type Line = { request: PublicPrintRequest; printType: PrintType; printer?: PrinterProfile; cost: number; price: number }

/** Prices each print on the printer it is assigned to, in the workspace's first material of its type, rounded as listed so the totals add up. */
function priceLines(
  requests: PublicPrintRequest[],
  rates: PriceCalculatorSettings,
  printers: PrinterProfile[],
  printerRuns: PrinterRunCount[],
  consumables: Consumable[],
  equipment: EquipmentItem[],
) {
  const priced: Line[] = []
  const unpriced: PublicPrintRequest[] = []
  for (const request of requests) {
    const estimate = requestPrintEstimate(request)
    const printer = printers.find(({ id, printType }) => id === request.printer?.id && printType === request.printType)
    const quote =
      request.printType && estimate
        ? priceRequest(
            { rates, consumables, printer, equipment, printerRuns },
            { ...estimate, printType: request.printType, quantity: request.quantity },
          )
        : undefined
    if (quote && request.printType) {
      const rounded = roundQuote(quote.result, rates.currency)
      priced.push({ request, printType: request.printType, printer, cost: rounded.costToMake, price: rounded.suggestedPrice })
    } else unpriced.push(request)
  }
  return { priced, unpriced }
}

/** One cost basis per printer the prints run on, or per print type for prints with no printer. */
function basisEntries(priced: Line[], rates: PriceCalculatorSettings, consumables: Consumable[], equipment: EquipmentItem[]) {
  const entries = new Map<string, CostBasisEntry>()
  for (const { printType, printer } of priced) {
    const key = printer?.id ?? printType
    if (!entries.has(key))
      entries.set(key, {
        key,
        printerName: printer?.name,
        basis: costBasis({ rates, printType, consumables, printer, equipment: defaultFinishing(equipment, printType) }),
      })
  }
  return [...entries.values()]
}

export function BatchEstimate({
  requestIds,
  settings,
  saved,
  printers,
  printerRuns,
  consumables,
  equipment,
}: {
  requestIds: string[]
  settings: PriceCalculatorSettings
  saved: boolean
  printers: PrinterProfile[]
  printerRuns: PrinterRunCount[]
  consumables: Consumable[]
  equipment: EquipmentItem[]
}) {
  const i18n = useI18n()
  const { t, locale } = i18n
  const copy = t.calculator.batch
  const workspaceSlug = useWorkspaceSlug()
  const query = useQuery(requestsQuery(workspaceSlug))
  const { copied, copy: copyTotal } = useCopied()
  const money = (value: number) => formatMoney(value, settings.currency, locale)
  const back = (
    <Link to="/calculator" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
      <ArrowLeft /> {copy.single}
    </Link>
  )
  if (!query.data) {
    return (
      <SettingsPage>
        <PageHeader title={t.calculator.title} actions={back} />
        <QueryState
          loading={query.isPending}
          error={query.error}
          loadingLabel={t.calculator.loading}
          errorTitle={t.calculator.loadError}
          onRetry={() => void query.refetch()}
        />
      </SettingsPage>
    )
  }
  const wanted = new Set(requestIds)
  const requests = query.data.requests.filter((request) => wanted.has(request.id))
  const { priced, unpriced } = priceLines(requests, settings, printers, printerRuns, consumables, equipment)
  const copies = priced.reduce((sum, { request }) => sum + request.quantity, 0)
  const cost = priced.reduce((sum, line) => sum + line.cost, 0)
  const price = priced.reduce((sum, line) => sum + line.price, 0)
  return (
    <SettingsPage>
      <PageHeader title={copy.title(requests.length)} description={copy.description} actions={back} />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,0.8fr)]">
        <Docket title={copy.prints}>
          <ul className="-mx-1 grid">
            {priced.map(({ request, printer, cost: lineCost, price: linePrice }) => (
              <li key={request.id} className="flex items-center gap-3 border-b border-border/70 px-1 py-2.5 last:border-b-0">
                <span className="relative size-10 shrink-0">
                  <RequestThumb request={request} />
                </span>
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="ph-no-capture truncate text-sm font-semibold">{request.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {[
                      `×${request.quantity}`,
                      printer?.name ?? copy.defaults,
                      printEstimateSummary(request, i18n) && copy.each(printEstimateSummary(request, i18n)!),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <span className="grid shrink-0 justify-items-end gap-0.5">
                  <span className="font-mono text-sm font-medium tabular-nums">{money(linePrice)}</span>
                  <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{copy.costs(money(lineCost))}</span>
                </span>
              </li>
            ))}
          </ul>
          {unpriced.length > 0 && (
            <p className="rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
              {copy.unpriced(unpriced.length)} <span className="ph-no-capture">{unpriced.map(({ name }) => name).join(', ')}</span>
            </p>
          )}
        </Docket>
        <div className="lg:sticky lg:top-7">
          <Docket title={copy.total}>
            <div className="rounded-lg border border-border bg-ticket px-4 py-5 text-center text-ticket-foreground">
              <div className="font-heading text-[11px] font-semibold tracking-[0.015em] text-muted-foreground uppercase">
                {t.calculator.quote.suggestedPrice}
              </div>
              <div className={cn('mt-1 font-heading text-5xl font-extrabold tracking-tight', !priced.length && 'text-muted-foreground')}>
                {priced.length ? money(price) : '—'}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {priced.length ? copy.summary(priced.length, copies, money(cost)) : copy.nothingPriced}
              </p>
              {priced.length > 0 && (
                <Button type="button" variant="ghost" size="xs" className="mt-2" onClick={() => copyTotal(money(price))}>
                  {copied ? null : <Copy />}
                  <CopyButtonLabel copied={copied} />
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{copy.basis}</p>
            {priced.length > 0 && (
              <CostBasisList entries={basisEntries(priced, settings, consumables, equipment)} currency={settings.currency} compact />
            )}
            <RatesLink settings={settings} saved={saved} />
          </Docket>
        </div>
      </div>
    </SettingsPage>
  )
}
