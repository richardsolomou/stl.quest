import type { PriceCalculatorJob } from '../core/priceCalculator'
import { isPrintType, type PrintType } from '../core/types'

export type CalculatorSearch = {
  printType?: PrintType
  material?: number
  unit?: PriceCalculatorJob['materialUnit']
  hours?: number
  plates?: number
  printer?: string
  /** Comma-separated request IDs to estimate together, chosen on the board. */
  requests?: string
}

const MAX_ESTIMATED_REQUESTS = 200

export function calculatorSearch(printType: PrintType, job: PriceCalculatorJob, printerId?: string): CalculatorSearch {
  return {
    printType,
    material: round(job.materialAmount),
    unit: job.materialUnit,
    hours: round(job.printHours),
    plates: job.plates,
    printer: printerId,
  }
}

export function validateCalculatorSearch(input: Record<string, unknown>): CalculatorSearch {
  const plates = amount(input.plates)
  return {
    printType: isPrintType(input.printType) ? input.printType : undefined,
    material: amount(input.material),
    unit: input.unit === 'ml' || input.unit === 'g' ? input.unit : undefined,
    hours: amount(input.hours),
    plates: Number.isInteger(plates) ? plates : undefined,
    printer: typeof input.printer === 'string' && input.printer.length > 0 && input.printer.length <= 200 ? input.printer : undefined,
    requests: typeof input.requests === 'string' && estimatedRequestIds(input.requests).length > 0 ? input.requests : undefined,
  }
}

export function calculatorPrefill(search: CalculatorSearch) {
  if (!search.printType) return undefined
  return {
    printType: search.printType,
    printerId: search.printer,
    job: {
      materialAmount: search.material ?? 0,
      materialUnit: search.printType === 'filament' ? 'g' : (search.unit ?? 'ml'),
      printHours: search.hours ?? 0,
      plates: search.plates ?? 1,
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

export function estimatedRequestIds(requests: string | undefined) {
  if (!requests) return []
  return [...new Set(requests.split(',').filter((id) => id.length > 0 && id.length <= 200))].slice(0, MAX_ESTIMATED_REQUESTS)
}
