import { SegmentedControl } from '@/components/ui/segmented-control'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import type { PriceCalculatorJob, PrintCost } from '../../../core/priceCalculator'
import type { PrintType } from '../../../core/types'
import { useI18n } from '../../i18n'
import { Docket } from '../settings/SettingsLayout'
import { NumberInput } from './fields'
import { formatNumber } from './format'

/** The slicer's totals and the hands-on time: the amounts the quote multiplies its cost basis by. */
export function JobSection({
  printType,
  job,
  result,
  density,
  onJobChange,
}: {
  printType: PrintType
  job: PriceCalculatorJob
  result: PrintCost
  /** The resin's density in g/mL, for converting between the slicer's millilitres and grams. */
  density: number
  onJobChange: (job: PriceCalculatorJob) => void
}) {
  const { t, locale } = useI18n()
  const copy = t.calculator.job
  return (
    <Docket title={copy.title} className="lg:col-start-1 lg:row-start-2">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Field className="col-span-2 sm:col-span-3">
          {/* Fixed height so the resin unit toggle doesn't shift the form when the print type changes. */}
          <div className="flex h-8 items-center justify-between gap-3">
            <FieldLabel htmlFor="calculator-material">{copy.expectedMaterial}</FieldLabel>
            {printType === 'resin' ? (
              <SegmentedControl
                legend={copy.materialUnit}
                size="xs"
                value={job.materialUnit}
                options={(['ml', 'g'] as const).map((unit) => ({ value: unit, label: unit }))}
                onChange={(unit) =>
                  onJobChange({
                    ...job,
                    materialAmount: unit === 'ml' ? result.materialMl : result.materialGrams,
                    materialUnit: unit,
                  })
                }
              />
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
            {printType === 'resin'
              ? copy.conversion(
                  formatNumber(job.materialUnit === 'ml' ? result.materialGrams : result.materialMl, locale),
                  job.materialUnit === 'ml' ? 'g' : 'mL',
                  formatNumber(density, locale),
                )
              : copy.filamentHint}
          </FieldDescription>
        </Field>
        {/* Inputs side by side line up even when one label wraps at phone width. */}
        <Field className="justify-end">
          <FieldLabel htmlFor="calculator-hours">{copy.printHours}</FieldLabel>
          <NumberInput
            id="calculator-hours"
            value={job.printHours}
            min={0}
            step="any"
            onChange={(printHours) => onJobChange({ ...job, printHours })}
          />
        </Field>
        <Field className="justify-end">
          <FieldLabel htmlFor="calculator-plates">{copy.plateRuns}</FieldLabel>
          <NumberInput
            id="calculator-plates"
            value={job.plates}
            min={0}
            step={1}
            onChange={(plates) => onJobChange({ ...job, plates: Math.round(plates) })}
          />
        </Field>
        <Field className="col-span-2 sm:col-span-1">
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
    </Docket>
  )
}
