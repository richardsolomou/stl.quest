import { describe, expect, it } from 'vitest'
import {
  equipmentFromPreset,
  EQUIPMENT_PRESETS,
  getEquipmentPreset,
  isPrinterAddOn,
  printerPowerProfile,
  printingPower,
  STANDALONE_EQUIPMENT_PRESETS,
} from './equipmentPresets'

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
    expect(printerPowerProfile('filament-bambu-lab-p1s')).toMatchObject({ watts: 105, basis: 'measured average while printing PLA' })
    expect(printerPowerProfile('filament-bambu-lab-h2d')).toEqual({ phase: 'printing', watts: 200 })
  })

  it('uses the measured printing average for the X1 Carbon rather than its peak', () => {
    expect(printerPowerProfile('filament-bambu-lab-x1-carbon')?.watts).toBe(105)
  })

  it('uses the measured printing average for the X1E', () => {
    expect(printerPowerProfile('filament-bambu-lab-x1e')?.watts).toBe(185)
  })

  it('uses typical power for Formlabs printers', () => {
    expect(printerPowerProfile('resin-formlabs-form-4')).toMatchObject({
      watts: 200,
      basis: 'typical use, middle of the published 150–250 W',
    })
  })

  it('applies the sourced Phrozen Sonic Mighty 12K power', () => {
    expect(printerPowerProfile('resin-phrozen-sonic-mighty-12k')?.watts).toBe(120)
  })

  it('shares power between Formlabs plus models and their base models', () => {
    expect(printerPowerProfile('resin-formlabs-form-3b-plus')?.watts).toBe(100)
  })

  it('adds an add-on module to the printer model it is bolted onto', () => {
    expect(printingPower('resin', 'resin-heygears-reflex-rs-turbo', ['accessory-heygears-pulsing-release-module']).watts).toBe(205)
  })

  it('takes the model power of a catalogue printer as known', () => {
    expect(printingPower('resin', 'resin-formlabs-form-4').typical).toBe(false)
  })

  it('stands in typical power for a printer without a catalogue model', () => {
    expect(printingPower('filament')).toEqual({ watts: 200, typical: true })
  })

  it('takes the power given to a printer without a catalogue model', () => {
    expect(printingPower('filament', undefined, [], 350)).toEqual({ watts: 350, typical: false })
  })

  it('keeps a catalogue model power over power given to the printer', () => {
    expect(printingPower('resin', 'resin-phrozen-sonic-mighty-12k', [], 999).watts).toBe(120)
  })

  it('offers modules that run while printing as printer add-ons', () => {
    expect(['accessory-heygears-pulsing-release-module', 'accessory-bambu-lab-ams'].every(isPrinterAddOn)).toBe(true)
  })

  it('keeps wash stations out of printer add-ons', () => {
    expect(isPrinterAddOn('postprocess-formlabs-form-wash-v2')).toBe(false)
  })

  it('offers wash, cure, and drying stations as standalone equipment', () => {
    expect(STANDALONE_EQUIPMENT_PRESETS.map(({ id }) => id)).toEqual(
      expect.arrayContaining(['postprocess-formlabs-form-wash-v2', 'accessory-sunlu-filadryer-s4']),
    )
  })

  it('leaves printers and printer add-ons out of standalone equipment', () => {
    const ids = new Set(STANDALONE_EQUIPMENT_PRESETS.map(({ id }) => id))
    expect(
      ['printer-formlabs-form-4', 'accessory-heygears-pulsing-release-module', 'accessory-bambu-lab-ams-2-pro'].filter((id) => ids.has(id)),
    ).toEqual([])
  })

  it('reads a combined station as wash and cure for resin finishing', () => {
    expect(equipmentFromPreset('a', getEquipmentPreset('postprocess-elegoo-mercury-plus-v3')!)).toMatchObject({
      name: 'Elegoo Mercury Plus V3.0',
      kind: 'wash-cure',
      stage: 'finishing',
      printType: 'resin',
      powerWatts: 60,
    })
  })

  it('reads a filament dryer as used before printing', () => {
    expect(equipmentFromPreset('a', getEquipmentPreset('accessory-sunlu-filadryer-s4')!)).toMatchObject({
      kind: 'dryer',
      stage: 'before-printing',
      printType: 'filament',
    })
  })

  it('takes the highest phase draw for a station with several phases', () => {
    expect(equipmentFromPreset('a', getEquipmentPreset('postprocess-uniformation-cure3-ultra')!).powerWatts).toBe(300)
  })

  it('shows the product photo of a catalogue station that has one', () => {
    expect(getEquipmentPreset('postprocess-prusa-cw1s')?.image).toEqual({ src: '/equipment-presets/postprocess-prusa-cw1s.webp' })
  })

  it('leaves a catalogue station without a product photo imageless', () => {
    expect(getEquipmentPreset('postprocess-uniformation-cure2')?.image).toBeUndefined()
  })
})
