import { storedPrinterProfiles } from './printers'
import { PRINT_TYPES, type PrintType } from './types'

export const PRINT_TYPE_SETTING = 'print-types'
export const PRINT_TYPE_CHOICES = ['automatic', 'resin', 'filament', 'both'] as const
export type PrintTypeChoice = (typeof PRINT_TYPE_CHOICES)[number]

export function isPrintTypeChoice(value: unknown): value is PrintTypeChoice {
  return (PRINT_TYPE_CHOICES as readonly unknown[]).includes(value)
}

/** What a workspace prints: the chosen types, or on automatic its active printers' types, and both before it has any. */
export function workspacePrintTypes(choice: PrintTypeChoice, printers: { printType: PrintType; archived?: boolean }[]): PrintType[] {
  if (choice === 'resin' || choice === 'filament') return [choice]
  const fleet = PRINT_TYPES.filter((printType) => printers.some((printer) => !printer.archived && printer.printType === printType))
  return choice === 'automatic' && fleet.length ? fleet : [...PRINT_TYPES]
}

/** The copy variant a workspace's print types call for: its one type's, or the one covering both. */
export function printTypeCopy(printTypes: PrintType[]): PrintType | 'both' {
  return printTypes.length === 1 ? printTypes[0] : 'both'
}

export async function storedPrintTypeChoice(repository: { getSetting<T>(key: string): Promise<T | undefined> }) {
  const stored = await repository.getSetting<unknown>(PRINT_TYPE_SETTING)
  return isPrintTypeChoice(stored) ? stored : 'automatic'
}

export async function storedWorkspacePrintTypes(repository: { getSetting<T>(key: string): Promise<T | undefined> }) {
  return workspacePrintTypes(await storedPrintTypeChoice(repository), await storedPrinterProfiles(repository))
}
