import { Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { cn } from '@/lib/utils'
import { CopyButtonLabel, useCopied } from '../useCopied'
import type { PriceCalculation, PriceCalculatorJob, PriceCalculatorSettings } from '../../../core/priceCalculator'
import type { PrinterSummary } from '../../../core/types'
import { useI18n } from '../../i18n'
import { SettingsSection } from '../settings/SettingsLayout'
import { formatMoney, formatNumber } from './format'

export type PriceMode = 'standard' | 'cost'

export function QuoteSection({
  settings,
  job,
  result,
  mode,
  comparison,
  printerId,
  onModeChange,
  onPrinterChange,
}: {
  settings: PriceCalculatorSettings
  job: PriceCalculatorJob
  result: PriceCalculation
  mode: PriceMode
  comparison: { printer: PrinterSummary; result: PriceCalculation }[]
  printerId?: string
  onModeChange: (mode: PriceMode) => void
  onPrinterChange: (printerId: string) => void
}) {
  const { t, locale } = useI18n()
  const copy = t.calculator.quote
  const { copied, copy: copyPrice } = useCopied()
  const price = mode === 'standard' ? result.standardPrice : result.estimatedCost
  // Consumables alone still produce a price, which reads as a real quote before any slicer totals are in.
  const empty = job.materialAmount === 0 && job.printHours === 0
  const money = (value: number) => formatMoney(value, settings.currency, locale)
  const explanation =
    mode === 'standard' ? copy.standardExplanation(formatNumber(settings.standardMarginPercent, locale)) : copy.costExplanation
  return (
    <div className="lg:sticky lg:top-7 lg:col-start-2 lg:row-start-1 lg:row-span-2">
      <SettingsSection title={copy.title} className="border-blueprint/30 bg-card/70 shadow-sm">
        <SegmentedControl
          legend={copy.priceMode}
          value={mode}
          options={(['standard', 'cost'] as const).map((option) => ({
            value: option,
            label: <span className="capitalize">{copy.modes[option]}</span>,
          }))}
          onChange={onModeChange}
        />
        <div className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-5 text-center">
          <div className="font-heading text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            {copy.suggestedPrice}
          </div>
          <div className={cn('mt-1 font-heading text-4xl font-semibold tracking-tight', empty && 'text-muted-foreground')}>
            {money(price)}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{empty ? copy.emptyHint : explanation}</p>
          {!empty && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="mt-2"
              aria-label={copy.copyPrice}
              onClick={() => copyPrice(money(price))}
            >
              {copied ? null : <Copy />}
              <CopyButtonLabel copied={copied} />
            </Button>
          )}
        </div>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
          <CostRow
            label={
              settings.printType === 'resin'
                ? copy.resinAmount(formatNumber(result.materialMl, locale))
                : copy.filamentAmount(formatNumber(result.materialGrams, locale))
            }
            value={money(result.material)}
          />
          <CostRow label={copy.printElectricity} value={money(result.printElectricity)} />
          {result.washElectricity > 0 && <CostRow label={copy.washElectricity} value={money(result.washElectricity)} />}
          {result.dryElectricity > 0 && <CostRow label={copy.dryElectricity} value={money(result.dryElectricity)} />}
          {result.cureElectricity > 0 && <CostRow label={copy.cureElectricity} value={money(result.cureElectricity)} />}
          <CostRow label={copy.equipmentWear} value={money(result.equipment)} />
          <CostRow label={copy.consumables(job.plates)} value={money(result.consumables)} />
          <CostRow label={copy.failureAllowance} value={money(result.failureAllowance)} />
          {mode === 'standard' && <CostRow label={copy.labour} value={money(result.labour)} />}
          <div className="col-span-2 mt-1 border-t border-dashed border-border" />
          <dt className="font-medium">{copy.estimatedCost}</dt>
          <dd className="font-mono font-medium tabular-nums">{money(result.estimatedCost)}</dd>
        </dl>
        {!empty && comparison.length > 1 && (
          <div className="grid min-w-0 gap-1 border-t border-border/70 pt-3">
            <div className="font-heading text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              {copy.onEachPrinter}
            </div>
            {comparison.map(({ printer, result: printerResult }) => (
              <button
                key={printer.id}
                type="button"
                aria-pressed={printer.id === printerId}
                className={cn(
                  'flex min-w-0 items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted',
                  printer.id === printerId && 'bg-muted font-medium',
                )}
                onClick={() => onPrinterChange(printer.id)}
              >
                <span className="min-w-0 truncate">{printer.name}</span>
                <span className="shrink-0 font-mono tabular-nums">
                  {money(mode === 'standard' ? printerResult.standardPrice : printerResult.estimatedCost)}
                </span>
              </button>
            ))}
          </div>
        )}
      </SettingsSection>
    </div>
  )
}

function CostRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </>
  )
}
