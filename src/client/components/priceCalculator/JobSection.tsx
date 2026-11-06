import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel, FieldTitle } from '@/components/ui/field'
import type { PriceCalculation, PriceCalculatorJob, PriceCalculatorSettings } from '../../../core/priceCalculator'
import { useI18n } from '../../i18n'
import { SettingsSection } from '../settings/SettingsLayout'
import { NumberInput } from './fields'
import { formatNumber } from './format'

export function JobSection({
  settings,
  job,
  result,
  onJobChange,
  onPrintTypeChange,
}: {
  settings: PriceCalculatorSettings
  job: PriceCalculatorJob
  result: PriceCalculation
  onJobChange: (job: PriceCalculatorJob) => void
  onPrintTypeChange: (printType: PriceCalculatorSettings['printType']) => void
}) {
  const { t, locale } = useI18n()
  const copy = t.calculator.job
  return (
    <SettingsSection title={copy.title} className="lg:col-start-1 lg:row-start-1">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field className="sm:col-span-2">
          <FieldTitle>{copy.printType}</FieldTitle>
          <fieldset className="flex rounded-lg border border-input bg-background p-1">
            <legend className="sr-only">{copy.printType}</legend>
            {(['resin', 'filament'] as const).map((value) => (
              <Button
                key={value}
                id={`calculator-print-type-${value}`}
                type="button"
                variant={settings.printType === value ? 'secondary' : 'ghost'}
                className="flex-1"
                aria-pressed={settings.printType === value}
                onClick={() => onPrintTypeChange(value)}
              >
                {copy[value]}
              </Button>
            ))}
          </fieldset>
        </Field>
        <Field className="sm:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <FieldLabel htmlFor="calculator-material">{copy.expectedMaterial}</FieldLabel>
            {settings.printType === 'resin' ? (
              <div className="flex rounded-lg border border-input bg-background p-0.5" aria-label={copy.materialUnit}>
                {(['ml', 'g'] as const).map((unit) => (
                  <Button
                    key={unit}
                    type="button"
                    size="xs"
                    variant={job.materialUnit === unit ? 'secondary' : 'ghost'}
                    aria-pressed={job.materialUnit === unit}
                    onClick={() =>
                      onJobChange({
                        ...job,
                        materialAmount: unit === 'ml' ? result.materialMl : result.materialGrams,
                        materialUnit: unit,
                      })
                    }
                  >
                    {unit}
                  </Button>
                ))}
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">{copy.grams}</span>
            )}
          </div>
          <NumberInput
            id="calculator-material"
            value={job.materialAmount}
            min={0}
            step="any"
            onChange={(materialAmount) => onJobChange({ ...job, materialAmount })}
          />
          <FieldDescription>
            {settings.printType === 'resin'
              ? copy.conversion(
                  formatNumber(job.materialUnit === 'ml' ? result.materialGrams : result.materialMl, locale),
                  job.materialUnit === 'ml' ? 'g' : 'mL',
                  formatNumber(settings.resinDensityGramsPerMl, locale),
                )
              : copy.filamentHint}
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="calculator-hours">{copy.printHours}</FieldLabel>
          <NumberInput
            id="calculator-hours"
            value={job.printHours}
            min={0}
            step="any"
            onChange={(printHours) => onJobChange({ ...job, printHours })}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="calculator-plates">{copy.plateRuns}</FieldLabel>
          <NumberInput
            id="calculator-plates"
            value={job.plates}
            min={0}
            step={1}
            onChange={(plates) => onJobChange({ ...job, plates: Math.round(plates) })}
          />
        </Field>
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="calculator-labour">{copy.handsOnTime}</FieldLabel>
          <NumberInput
            id="calculator-labour"
            value={job.handsOnMinutes}
            min={0}
            step={1}
            onChange={(handsOnMinutes) => onJobChange({ ...job, handsOnMinutes })}
          />
          <FieldDescription>{copy.handsOnHint}</FieldDescription>
        </Field>
      </div>
    </SettingsSection>
  )
}
