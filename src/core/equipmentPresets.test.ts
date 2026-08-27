import { describe, expect, it } from 'vitest'
import { equipmentPowerTotals, EQUIPMENT_PRESETS, printerPowerProfile } from './equipmentPresets'

describe('equipment presets', () => {
  it('keeps unique IDs with official sources and non-negative power', () => {
    expect(new Set(EQUIPMENT_PRESETS.map((preset) => preset.id)).size).toBe(EQUIPMENT_PRESETS.length)
    expect(
      EQUIPMENT_PRESETS.every(
        (preset) =>
          preset.powerProfiles.length > 0 &&
          preset.powerProfiles.every((profile) => profile.watts >= 0) &&
          preset.source.url.startsWith('https://'),
      ),
    ).toBe(true)
  })

  it('separates FDM accessories from resin accessories', () => {
    expect(EQUIPMENT_PRESETS.filter((preset) => preset.printType === 'filament').map((preset) => preset.id)).toEqual(
      expect.arrayContaining(['accessory-bambu-lab-ams', 'accessory-creality-space-pi-dryer', 'accessory-sunlu-filadryer-s4']),
    )
    expect(EQUIPMENT_PRESETS.find((preset) => preset.id === 'printer-heygears-reflex-rs-turbo')?.printType).toBeUndefined()
  })

  it('uses the main printer catalogue with sourced power or a process default', () => {
    expect(printerPowerProfile('filament-bambu-lab-p1s')).toMatchObject({ watts: 1000, basis: 'maximum power at 220 V' })
    expect(printerPowerProfile('filament-bambu-lab-h2d')).toMatchObject({ watts: 200, basis: expect.stringContaining('default estimate') })
  })

  it('adds printing, washing, drying, and curing power independently', () => {
    expect(
      equipmentPowerTotals([
        'resin-heygears-reflex-rs-turbo',
        'accessory-heygears-pulsing-release-module',
        'postprocess-elegoo-mercury-plus-v3',
      ]),
    ).toEqual({ printing: 205, washing: 60, drying: 0, curing: 60 })
  })

  it('supports equipment with mode-specific power', () => {
    expect(equipmentPowerTotals(['postprocess-uniformation-cure3-ultra'])).toEqual({
      printing: 0,
      washing: 0,
      drying: 300,
      curing: 80,
    })
  })

  it('counts filament drying separately from printing', () => {
    expect(equipmentPowerTotals(['filament-bambu-lab-p1s', 'accessory-bambu-lab-ams-2-pro'])).toEqual({
      printing: 1000,
      washing: 0,
      drying: 96,
      curing: 0,
    })
  })
})
