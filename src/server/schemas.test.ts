import { describe, expect, it } from 'vitest'
import { DEFAULT_PRICE_CALCULATOR_SETTINGS } from '../core/priceCalculator'
import {
  acceptInviteSchema,
  createLinkedRequestSchema,
  createPrintGroupSchema,
  createInviteSchema,
  moveCopiesSchema,
  priceCalculatorSettingsSchema,
  printerProfilesSchema,
  requestFiltersSchema,
  storageSettingsSchema,
  updateRequestSchema,
} from './schemas'

describe('server input schemas', () => {
  it('normalizes invite identity fields', () => {
    expect(createInviteSchema.parse({ role: 'requester', email: ' PERSON@EXAMPLE.COM ' })).toEqual({
      role: 'requester',
      email: 'person@example.com',
    })
    expect(
      acceptInviteSchema.parse({
        token: 'invite-token',
        name: '  Ada  ',
        email: 'ADA@EXAMPLE.COM',
        password: 'password1234',
      }),
    ).toEqual({
      token: 'invite-token',
      name: 'Ada',
      email: 'ada@example.com',
      password: 'password1234',
    })
    expect(() => acceptInviteSchema.parse({ token: 'invite-token', name: 'Ada', email: 'ada@example.com', password: '1234567' })).toThrow()
  })

  it('validates and normalizes storage settings', () => {
    expect(storageSettingsSchema.parse({ adapter: 'local', root: '  /prints  ' })).toEqual({ adapter: 'local', root: '/prints' })
    expect(storageSettingsSchema.parse({ adapter: 'dropbox', root: '  STL Quest/models  ' })).toEqual({
      adapter: 'dropbox',
      root: 'STL Quest/models',
    })
    expect(
      storageSettingsSchema.parse({
        adapter: 'webdav',
        endpoint: 'https://storage.example.com/dav',
        root: '  stlquest  ',
        username: ' user ',
        password: 'secret',
      }),
    ).toEqual({ adapter: 'webdav', endpoint: 'https://storage.example.com/dav', root: 'stlquest', username: 'user', password: 'secret' })
    expect(() => storageSettingsSchema.parse({ adapter: 'local', root: 'relative' })).toThrow()
    expect(() =>
      storageSettingsSchema.parse({
        adapter: 's3',
        endpoint: 'file:///tmp',
        region: 'us-east-1',
        bucket: 'models',
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        forcePathStyle: false,
      }),
    ).toThrow()
  })

  it('rejects malformed request updates', () => {
    expect(() => updateRequestSchema.parse({ id: 'request', quantity: 0 })).toThrow()
    expect(() => updateRequestSchema.parse({ id: 'request', sourceUrl: 'javascript:alert(1)' })).toThrow()
    expect(updateRequestSchema.parse({ id: 'request', sourceUrl: '' })).toEqual({ id: 'request', sourceUrl: '' })
    expect(updateRequestSchema.parse({ id: 'request', requestedPrintType: 'filament', printerId: null })).toEqual({
      id: 'request',
      requestedPrintType: 'filament',
      printerId: null,
    })
    expect(updateRequestSchema.parse({ id: 'request', requestedPrintType: 'resin', printerId: 'printer' })).toEqual({
      id: 'request',
      requestedPrintType: 'resin',
      printerId: 'printer',
    })
  })

  it('validates and normalizes linked requests', () => {
    expect(
      createLinkedRequestSchema.parse({
        name: '  Cable organizer  ',
        quantity: 2,
        notes: '  Black PLA  ',
        sourceUrl: '  https://makerworld.com/models/cable-organizer  ',
        requestedPrintType: 'filament',
      }),
    ).toEqual({
      name: 'Cable organizer',
      quantity: 2,
      notes: 'Black PLA',
      sourceUrl: 'https://makerworld.com/models/cable-organizer',
      requestedPrintType: 'filament',
    })
    expect(() =>
      createLinkedRequestSchema.parse({
        name: 'Cable organizer',
        quantity: 1,
        sourceUrl: 'javascript:alert(1)',
        requestedPrintType: 'filament',
      }),
    ).toThrow()
  })

  it('validates calculator settings', () => {
    const settings = {
      printType: 'resin',
      resinPresetId: 'resin-heygears-pap10',
      resinPricePerLitre: 70,
      resinDensityGramsPerMl: 1.25,
      filamentPricePerKg: 25,
      electricityCountryCode: 'CY',
      electricityPricePerKwh: 0.3,
      resinEquipment: {
        mode: 'preset',
        presetIds: ['resin-heygears-reflex-rs-turbo', 'accessory-heygears-pulsing-release-module', 'postprocess-elegoo-mercury-plus-v3'],
        printPowerWatts: 205,
        washPowerWatts: 60,
        washMinutesPerPlate: 5,
        dryPowerWatts: 0,
        dryMinutesPerPlate: 0,
        curePowerWatts: 60,
        cureMinutesPerPlate: 15,
      },
      filamentEquipment: DEFAULT_PRICE_CALCULATOR_SETTINGS.filamentEquipment,
      equipmentCostPerHour: 1.15,
      consumablesCostPerPlate: 0.5,
      labourCostPerHour: 15,
      failureAllowancePercent: 10,
      standardMarginPercent: 25,
    }

    expect(priceCalculatorSettingsSchema.parse(settings)).toMatchObject({
      resinPresetId: 'resin-heygears-pap10',
      electricityCountryCode: 'CY',
    })
    expect(priceCalculatorSettingsSchema.parse(DEFAULT_PRICE_CALCULATOR_SETTINGS)).toEqual(DEFAULT_PRICE_CALCULATOR_SETTINGS)
    expect(() => priceCalculatorSettingsSchema.parse({ ...settings, resinPricePerLitre: 0 })).toThrow()
    expect(() => priceCalculatorSettingsSchema.parse({ ...settings, standardMarginPercent: 100 })).toThrow()
  })

  it('validates board filters and cross-field ranges', () => {
    expect(requestFiltersSchema.parse({ query: '  orange gear  ', minQuantity: 2, sort: 'name-asc' })).toEqual({
      query: 'orange gear',
      minQuantity: 2,
      sort: 'name-asc',
    })
    expect(() => requestFiltersSchema.parse({ minQuantity: 5, maxQuantity: 2 })).toThrow()
    expect(() => requestFiltersSchema.parse({ minEstimatedMaterial: 80, maxEstimatedMaterial: 10 })).toThrow()
    expect(() => requestFiltersSchema.parse({ createdAfter: 20, createdBefore: 10 })).toThrow()
    expect(requestFiltersSchema.parse({ printType: 'filament', printerId: null })).toEqual({ printType: 'filament', printerId: null })
  })

  it('shares board identifiers and print-group name constraints', () => {
    expect(moveCopiesSchema.parse({ id: 'request', from: 'todo', to: 'done', count: 1 })).toEqual({
      id: 'request',
      from: 'todo',
      to: 'done',
      count: 1,
    })
    expect(createPrintGroupSchema.parse({ name: '  Batch  ', status: 'todo', items: [] })).toEqual({
      name: 'Batch',
      status: 'todo',
      items: [],
    })
    expect(() => createPrintGroupSchema.parse({ name: ' ', status: 'todo', items: [] })).toThrow()
  })

  it('accepts explicit resin and filament printer profiles', () => {
    const resin = {
      id: 'resin',
      presetId: 'resin-elegoo-mars-2',
      name: 'Resin',
      printType: 'resin',
      widthMm: 100,
      depthMm: 60,
      heightMm: 150,
      spacingMm: 2,
      supportMarginMm: 2,
      adhesionMarginMm: 1,
      heightAllowanceMm: 4,
      maxHeightDifferenceMm: 20,
    }
    const filament = {
      id: 'filament',
      name: 'Filament',
      printType: 'filament',
      widthMm: 220,
      depthMm: 220,
      heightMm: 250,
      spacingMm: 3,
      brimMarginMm: 2,
      filamentDiameterMm: 1.75,
      materialDensityGPerCm3: 1.24,
    }

    expect(printerProfilesSchema.parse({ profiles: [resin, filament] }).profiles).toMatchObject([
      { id: 'resin', presetId: 'resin-elegoo-mars-2', widthMm: 100, depthMm: 60, heightMm: 150, printType: 'resin' },
      { id: 'filament', widthMm: 220, depthMm: 220, heightMm: 250, printType: 'filament' },
    ])
    expect(() => printerProfilesSchema.parse({ profiles: [resin, { ...filament, id: 'resin' }] })).toThrow()
  })
})
