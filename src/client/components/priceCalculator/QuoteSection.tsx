import { Button } from '@/components/ui/button'
import type { PriceCalculation, PriceCalculatorJob, PriceCalculatorSettings } from '../../../core/priceCalculator'
import { useI18n } from '../../i18n'
import { SettingsSection } from '../settings/SettingsLayout'
import { formatMoney, formatNumber } from './format'

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
  const { t, locale } = useI18n()
  const copy = t.calculator.quote
  const price = mode === 'standard' ? result.standardPrice : result.costPrice
  const money = (value: number) => formatMoney(value, settings.currency, locale)
  const explanation =
    mode === 'standard' ? copy.standardExplanation(formatNumber(settings.standardMarginPercent, locale)) : copy.costExplanation
  return (
    <div className="lg:sticky lg:top-7 lg:col-start-2 lg:row-start-1 lg:row-span-2">
      <SettingsSection title={copy.title} className="border-blueprint/30 bg-card/70 shadow-sm">
        <div className="flex rounded-lg border border-input bg-background p-1" aria-label={copy.priceMode}>
          {(['standard', 'cost'] as const).map((option) => (
            <Button
              key={option}
              type="button"
              variant={mode === option ? 'secondary' : 'ghost'}
              className="flex-1 capitalize"
              aria-pressed={mode === option}
              onClick={() => onModeChange(option)}
            >
              {copy.modes[option]}
            </Button>
          ))}
        </div>
        <div className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-5 text-center">
          <div className="text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">{copy.suggestedPrice}</div>
          <div className="mt-1 font-heading text-4xl font-semibold tracking-tight">{money(price)}</div>
          <p className="mt-2 text-xs text-muted-foreground">{explanation}</p>
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
