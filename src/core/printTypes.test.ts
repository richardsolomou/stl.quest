import { describe, expect, it } from 'vitest'
import { PRINT_TYPE_SETTING, printTypeCopy, storedPrintTypeChoice, storedWorkspacePrintTypes, workspacePrintTypes } from './printTypes'

const resin = { printType: 'resin' as const }
const filament = { printType: 'filament' as const }

describe('workspace print types', () => {
  it('follows a resin-only fleet on automatic', () => {
    expect(workspacePrintTypes('automatic', [resin])).toEqual(['resin'])
  })

  it('follows a mixed fleet on automatic in a fixed order', () => {
    expect(workspacePrintTypes('automatic', [filament, resin])).toEqual(['resin', 'filament'])
  })

  it('offers both before the workspace has printers', () => {
    expect(workspacePrintTypes('automatic', [])).toEqual(['resin', 'filament'])
  })

  it('ignores archived printers', () => {
    expect(workspacePrintTypes('automatic', [resin, { ...filament, archived: true }])).toEqual(['resin'])
  })

  it('keeps a chosen type whatever the fleet holds', () => {
    expect(workspacePrintTypes('filament', [resin])).toEqual(['filament'])
  })

  it('offers both when both are chosen for a single-type fleet', () => {
    expect(workspacePrintTypes('both', [resin])).toEqual(['resin', 'filament'])
  })
})

describe('stored print types', () => {
  const repository = (settings: Record<string, unknown>) => ({
    getSetting: async <T>(key: string) => settings[key] as T | undefined,
  })

  it('reads an unknown stored choice as automatic', async () => {
    expect(await storedPrintTypeChoice(repository({ [PRINT_TYPE_SETTING]: 'sla' }))).toBe('automatic')
  })

  it('resolves the stored choice against the stored printers', async () => {
    expect(await storedWorkspacePrintTypes(repository({ printers: [{ id: 'p', name: 'Saturn', printType: 'resin' }] }))).toEqual(['resin'])
  })
})

describe('print type copy', () => {
  it('names the one type a workspace prints', () => {
    expect(printTypeCopy(['filament'])).toBe('filament')
  })

  it('covers both types when a workspace prints both', () => {
    expect(printTypeCopy(['resin', 'filament'])).toBe('both')
  })
})
