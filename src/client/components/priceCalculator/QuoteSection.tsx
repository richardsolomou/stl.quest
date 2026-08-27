import { Button } from '@/components/ui/button'
import type { PriceCalculation, PriceCalculatorJob, PriceCalculatorSettings } from '../../../core/priceCalculator'
import { SettingsSection } from '../settings/SettingsLayout'
import { formatEuros, formatNumber } from './format'

export type PriceMode = 'standard' | 'cost'

export function QuoteSection({
  settings,
  job,
  result,
  mode,
  onModeChange,
}: {
  settings: PriceCalculatorSettings
  job: PriceCalculatorJob
  result: PriceCalculation
  mode: PriceMode
  onModeChange: (mode: PriceMode) => void
}) {
  const price = mode === 'standard' ? result.standardPrice : result.costPrice
  const explanation =
    mode === 'standard'
      ? `Includes labour and a ${formatNumber(settings.standardMarginPercent)}% margin.`
      : 'Covers materials, power, consumables, equipment wear, and failure allowance.'
  return (
    <div className="lg:sticky lg:top-7 lg:col-start-2 lg:row-start-1 lg:row-span-2">
      <SettingsSection title="Rough quote" className="border-blueprint/30 bg-card/70 shadow-sm">
        <div className="flex rounded-lg border border-input bg-background p-1" aria-label="Price mode">
          {(['standard', 'cost'] as const).map((option) => (
            <Button
              key={option}
              type="button"
              variant={mode === option ? 'secondary' : 'ghost'}
              className="flex-1 capitalize"
              aria-pressed={mode === option}
              onClick={() => onModeChange(option)}
            >
              {option}
            </Button>
          ))}
        </div>
        <div className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-5 text-center">
          <div className="text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">Suggested price</div>
          <div className="mt-1 font-heading text-4xl font-semibold tracking-tight">{formatEuros(price)}</div>
          <p className="mt-2 text-xs text-muted-foreground">{explanation}</p>
        </div>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
          <CostRow
            label={
              settings.printType === 'resin'
                ? `${formatNumber(result.materialMl)} mL resin`
                : `${formatNumber(result.materialGrams)} g filament`
            }
            value={result.material}
          />
          <CostRow label="Print electricity" value={result.printElectricity} />
          {result.washElectricity > 0 && <CostRow label="Wash electricity" value={result.washElectricity} />}
          {result.dryElectricity > 0 && <CostRow label="Dry electricity" value={result.dryElectricity} />}
          {result.cureElectricity > 0 && <CostRow label="Cure electricity" value={result.cureElectricity} />}
          <CostRow label="Equipment wear" value={result.equipment} />
          <CostRow label={`${job.plates} plate${job.plates === 1 ? '' : 's'} of consumables`} value={result.consumables} />
          <CostRow label="Failure allowance" value={result.failureAllowance} />
          {mode === 'standard' && <CostRow label="Labour" value={result.labour} />}
          <div className="col-span-2 mt-1 border-t border-dashed border-border" />
          <dt className="font-medium">Estimated cost</dt>
          <dd className="font-mono font-medium tabular-nums">{formatEuros(result.estimatedCost)}</dd>
        </dl>
      </SettingsSection>
    </div>
  )
}

function CostRow({ label, value }: { label: string; value: number }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono tabular-nums">{formatEuros(value)}</dd>
    </>
  )
}
