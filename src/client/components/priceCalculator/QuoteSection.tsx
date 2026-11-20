import { Fragment, type ReactNode } from 'react'
import { ChevronRight, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CopyButtonLabel, useCopied } from '../useCopied'
import type { CostBasis, PriceCalculatorJob, PriceCalculatorSettings, PrintCost } from '../../../core/priceCalculator'
import type { PrinterSummary, PrintType } from '../../../core/types'
import { useI18n } from '../../i18n'
import { Docket } from '../settings/SettingsLayout'
import { CostBasisList, TypicalTag } from './CostBasis'
import { formatMoney, formatNumber } from './format'

export function QuoteSection({
  rates,
  printType,
  job,
  result,
  basis,
  comparison,
  printer: selected,
  materialName,
  onPrinterChange,
  onTryTypicalJob,
  rateLink,
}: {
  rates: PriceCalculatorSettings
  printType: PrintType
  job: PriceCalculatorJob
  result: PrintCost
  /** What the picks cost per unit, shown with or without a job so the page says something before the slicer totals are in. */
  basis: CostBasis
  comparison: { printer: PrinterSummary; result: PrintCost }[]
  printer?: PrinterSummary
  materialName?: string
  onPrinterChange: (printerId: string) => void
  onTryTypicalJob: () => void
  rateLink: ReactNode
}) {
  const { t, locale } = useI18n()
  const copy = t.calculator.quote
  const { copied, copy: copyPrice } = useCopied()
  // Consumables alone still produce a price, which reads as a real quote before any slicer totals are in.
  const empty = job.materialAmount === 0 && job.printHours === 0
  const money = (value: number) => formatMoney(value, rates.currency, locale)
  const margin = formatNumber(rates.standardMarginPercent, locale)
  const others = [...comparison].sort((a, b) => a.result.suggestedPrice - b.result.suggestedPrice)
  const cheapest = others[0]?.result.suggestedPrice
  const dearest = others.at(-1)?.result.suggestedPrice
  const typical =
    result.material.typical || result.printing.typical || result.printing.wearTypical || result.equipment.some((line) => line.typical)
  return (
    <div className="lg:sticky lg:top-7 lg:col-start-2 lg:row-start-1 lg:row-span-2">
      <Docket title={copy.title} className="bg-card">
        <div className="rounded-lg border border-border bg-ticket px-4 py-5 text-center text-ticket-foreground">
          <div className="font-heading text-[11px] font-semibold tracking-[0.015em] text-muted-foreground uppercase">
            {copy.suggestedPrice}
          </div>
          {empty ? (
            <>
              <p className="mx-auto mt-2 max-w-64 text-sm text-muted-foreground">{copy.emptyHint}</p>
              <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onTryTypicalJob}>
                {copy.tryTypicalJob}
              </Button>
            </>
          ) : (
            <>
              <div className="mt-1 font-heading text-5xl font-extrabold tracking-tight">{money(result.suggestedPrice)}</div>
              <p className="mt-2 text-xs text-muted-foreground">{copy.costAndMargin(money(result.estimatedCost), margin)}</p>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="mt-2"
                aria-label={copy.copyPrice}
                onClick={() => copyPrice(money(result.suggestedPrice))}
              >
                {copied ? null : <Copy />}
                <CopyButtonLabel copied={copied} />
              </Button>
            </>
          )}
        </div>
        {!empty && (
          <Disclosure summary={copy.breakdown}>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
              <CostRow
                label={
                  printType === 'resin'
                    ? copy.resinAmount(formatNumber(result.materialMl, locale))
                    : copy.filamentAmount(formatNumber(result.materialGrams, locale))
                }
                value={money(result.material.cost)}
                typical={result.material.typical}
              />
              <CostRow label={copy.printElectricity} value={money(result.printing.electricity)} typical={result.printing.typical} />
              <CostRow label={copy.printerWear} value={money(result.printing.wear)} typical={result.printing.wearTypical} />
              {result.wearParts.map(({ part, cost }) => cost > 0 && <CostRow key={part.id} label={part.name} value={money(cost)} />)}
              {result.equipment.map(({ item, typical: standIn, electricity, supplies, wear }) => {
                const name = standIn ? copy.typicalFinishing : item.name
                return (
                  <Fragment key={item.id}>
                    <CostRow label={copy.equipmentPower(name)} value={money(electricity)} typical={standIn} />
                    {supplies > 0 && <CostRow label={copy.equipmentSupplies(name)} value={money(supplies)} />}
                    {wear > 0 && <CostRow label={copy.equipmentWear(name)} value={money(wear)} />}
                  </Fragment>
                )
              })}
              <CostRow label={copy.failureAllowance} value={money(result.failureAllowance)} />
              <TotalRow label={copy.estimatedCost} value={money(result.estimatedCost)} />
              {result.labour > 0 && <CostRow label={copy.labour} value={money(result.labour)} />}
              <CostRow label={copy.marginAmount(margin)} value={money(result.margin)} />
              <TotalRow label={copy.suggestedPrice} value={money(result.suggestedPrice)} />
            </dl>
            {typical && <p className="mt-3 text-xs text-muted-foreground">{copy.typicalNote}</p>}
          </Disclosure>
        )}
        {!empty && others.length > 1 && cheapest !== undefined && dearest !== undefined && (
          <Disclosure
            summary={copy.compare(others.length, cheapest === dearest ? money(cheapest) : `${money(cheapest)}–${money(dearest)}`)}
          >
            <div className="app-scrollbar grid max-h-64 min-w-0 gap-0.5 overflow-y-auto">
              {others.map(({ printer, result: printerResult }) => (
                <button
                  key={printer.id}
                  type="button"
                  aria-pressed={printer.id === selected?.id}
                  className={cn(
                    'flex min-w-0 items-center justify-between gap-3 rounded-md px-2 py-1 text-left text-sm hover:bg-muted',
                    printer.id === selected?.id && 'bg-muted font-medium',
                  )}
                  onClick={() => onPrinterChange(printer.id)}
                >
                  <span className="min-w-0 truncate">{printer.name}</span>
                  <span className="shrink-0 font-mono tabular-nums">{money(printerResult.suggestedPrice)}</span>
                </button>
              ))}
            </div>
          </Disclosure>
        )}
        <CostBasisList entries={[{ key: 'picked', basis, printerName: selected?.name, materialName }]} currency={rates.currency} />
        {rateLink}
      </Docket>
    </div>
  )
}

function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group border-t border-border/70 pt-3">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90" />
        {summary}
      </summary>
      <div className="mt-2.5">{children}</div>
    </details>
  )
}

function CostRow({ label, value, typical = false }: { label: string; value: string; typical?: boolean }) {
  return (
    <>
      <dt className="min-w-0 text-muted-foreground">
        {label}
        {typical && <TypicalTag />}
      </dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </>
  )
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <div className="col-span-2 my-0.5 border-t border-dashed border-border" />
      <dt className="font-medium">{label}</dt>
      <dd className="font-mono font-medium tabular-nums">{value}</dd>
    </>
  )
}
