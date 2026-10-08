import type { PriceCalculatorJob, PriceCalculatorSettings } from '../core/priceCalculator'

export type CalculatorSearch = {
  printType?: PriceCalculatorSettings['printType']
  material?: number
  unit?: PriceCalculatorJob['materialUnit']
  hours?: number
}

export function calculatorSearch(printType: PriceCalculatorSettings['printType'], job: PriceCalculatorJob): CalculatorSearch {
  return { printType, material: round(job.materialAmount), unit: job.materialUnit, hours: round(job.printHours) }
}

export function validateCalculatorSearch(input: Record<string, unknown>): CalculatorSearch {
  return {
    printType: input.printType === 'resin' || input.printType === 'filament' ? input.printType : undefined,
    material: amount(input.material),
    unit: input.unit === 'ml' || input.unit === 'g' ? input.unit : undefined,
    hours: amount(input.hours),
  }
}

export function calculatorPrefill(search: CalculatorSearch) {
  if (!search.printType) return undefined
  return {
    printType: search.printType,
    job: {
      materialAmount: search.material ?? 0,
      materialUnit: search.printType === 'filament' ? 'g' : (search.unit ?? 'ml'),
      printHours: search.hours ?? 0,
    } satisfies Partial<PriceCalculatorJob>,
  }
}

function amount(value: unknown) {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function round(value: number) {
  return Math.round(value * 100) / 100
}
