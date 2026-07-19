import { describe, expect, it } from 'vitest'
import {
  acceptInviteSchema,
  createInviteSchema,
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
    expect(storageSettingsSchema.parse({ adapter: 'dropbox', root: '  PrintHub/models  ' })).toEqual({
      adapter: 'dropbox',
      root: 'PrintHub/models',
    })
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
    })
    expect(updateRequestSchema.parse({ id: 'request', requestedPrintType: 'resin', printerId: 'printer' })).toEqual({
      id: 'request',
      requestedPrintType: 'resin',
    })
  })

  it('validates board filters and cross-field ranges', () => {
    expect(requestFiltersSchema.parse({ query: '  orange gear  ', minQuantity: 2, sort: 'name-asc' })).toEqual({
      query: 'orange gear',
      minQuantity: 2,
      sort: 'name-asc',
    })
    expect(() => requestFiltersSchema.parse({ minQuantity: 5, maxQuantity: 2 })).toThrow()
    expect(() => requestFiltersSchema.parse({ createdAfter: 20, createdBefore: 10 })).toThrow()
    expect(requestFiltersSchema.parse({ printType: 'filament', printerId: null })).toEqual({ printType: 'filament', printerId: null })
  })

  it('accepts explicit resin and filament printer profiles', () => {
    const resin = {
      id: 'resin',
      presetId: 'resin-elegoo-mars-2',
      name: 'Resin',
      printType: 'resin',
      enabled: true,
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
      enabled: true,
      widthMm: 220,
      depthMm: 220,
      heightMm: 250,
      spacingMm: 3,
      brimMarginMm: 2,
      filamentDiameterMm: 1.75,
      materialDensityGPerCm3: 1.24,
    }

    expect(printerProfilesSchema.parse({ profiles: [resin, filament] }).profiles).toMatchObject([
      { id: 'resin', presetId: 'resin-elegoo-mars-2', printType: 'resin', enabled: true },
      { id: 'filament', printType: 'filament', enabled: true },
    ])
    expect(() => printerProfilesSchema.parse({ profiles: [resin, { ...filament, id: 'resin' }] })).toThrow()
  })
})
