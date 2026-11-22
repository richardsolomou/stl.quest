import { describe, expect, it } from 'vitest'
import { MAX_EMAIL_TEMPLATE_PLACEHOLDERS } from '../core/email'
import { DEFAULT_PRICE_CALCULATOR_SETTINGS } from '../core/priceCalculator'
import { MAX_BULK_CARDS } from '../core/request'
import { MAX_COVER_BYTES } from '../core/coverImage'
import {
  archiveRequestsSchema,
  deleteRequestsSchema,
  moveCopiesBatchSchema,
  updatePrintCopyTagsSchema,
  acceptInviteSchema,
  spoolmanIngestSchema,
  boardSettingsSchema,
  createConsumablesSchema,
  createLinkedRequestSchema,
  requestCoverSchema,
  createPrintGroupSchema,
  createInviteSchema,
  emailSenderSchema,
  emailTemplateSchema,
  moveCopiesSchema,
  notificationPreferenceSchema,
  priceCalculatorSettingsSchema,
  inventoryItemSchema,
  requestFiltersSchema,
  storageSettingsSchema,
  socialProviderSettingsSchema,
  updateRequestSchema,
} from './schemas'

describe('board settings schema', () => {
  it('accepts turning automatic archiving off', () => {
    expect(boardSettingsSchema.parse({ autoArchiveDays: null })).toEqual({ autoArchiveDays: null })
  })

  it.each([0, 1.5, 366])('rejects an automatic archive delay of %s days', (autoArchiveDays) => {
    expect(boardSettingsSchema.safeParse({ autoArchiveDays }).success).toBe(false)
  })

  it('rejects an update that changes nothing', () => {
    expect(boardSettingsSchema.safeParse({}).success).toBe(false)
  })
})

describe('create consumables schema', () => {
  const filament = (id: string) => ({ id, kind: 'filament', name: id, pricePerKg: 20 })

  it('accepts several filaments counted at one amount', () => {
    expect(createConsumablesSchema.safeParse({ items: [filament('a'), filament('b')], onHand: 1_000 }).success).toBe(true)
  })

  it('rejects two items with the same ID', () => {
    expect(createConsumablesSchema.safeParse({ items: [filament('a'), filament('a')] }).success).toBe(false)
  })

  it('rejects items of different kinds', () => {
    const ipa = { id: 'ipa', kind: 'supply', name: 'IPA', unit: 'ml', price: 10 }
    expect(createConsumablesSchema.safeParse({ items: [filament('a'), ipa] }).success).toBe(false)
  })

  it('rejects an empty list', () => {
    expect(createConsumablesSchema.safeParse({ items: [] }).success).toBe(false)
  })
})

describe('server input schemas', () => {
  const printer = (item: unknown) => inventoryItemSchema.safeParse({ inventory: 'printers', item })
  it('rejects unknown notification kinds', () => {
    expect(notificationPreferenceSchema.safeParse({ kind: 'webhook', enabled: true }).success).toBe(false)
  })

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

  it('accepts a cover image supplied with a linked print', () => {
    const cover = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64')

    expect(
      createLinkedRequestSchema.parse({
        name: 'Dragon',
        quantity: 1,
        sourceUrl: 'https://cults3d.com/x',
        requestedPrintType: 'resin',
        cover,
      }),
    ).toMatchObject({ cover })
  })

  it('accepts a cover image at the size limit', () => {
    const image = Buffer.alloc(MAX_COVER_BYTES).toString('base64')

    expect(requestCoverSchema.safeParse({ id: 'print', image }).success).toBe(true)
  })

  it('refuses a cover image over the size limit before decoding it', () => {
    const image = Buffer.alloc(MAX_COVER_BYTES + 3).toString('base64')

    expect(requestCoverSchema.safeParse({ id: 'print', image }).success).toBe(false)
  })

  it('refuses a cover that is not base64', () => {
    expect(requestCoverSchema.safeParse({ id: 'print', image: '<svg/>' }).success).toBe(false)
  })

  it('accepts the business rates', () => {
    expect(priceCalculatorSettingsSchema.parse({ ...DEFAULT_PRICE_CALCULATOR_SETTINGS, electricityCountryCode: 'CY' })).toMatchObject({
      electricityCountryCode: 'CY',
    })
  })

  it('rejects a markup above its maximum', () => {
    expect(() => priceCalculatorSettingsSchema.parse({ ...DEFAULT_PRICE_CALCULATOR_SETTINGS, markupPercent: 2_001 })).toThrow()
  })

  it('rejects a supports and waste allowance above 200%', () => {
    expect(() =>
      priceCalculatorSettingsSchema.parse({ ...DEFAULT_PRICE_CALCULATOR_SETTINGS, supportsAndWastePercent: { resin: 201, filament: 10 } }),
    ).toThrow()
  })

  it('rejects a negative resin amount per part', () => {
    expect(() => priceCalculatorSettingsSchema.parse({ ...DEFAULT_PRICE_CALCULATOR_SETTINGS, resinPerPartMl: -1 })).toThrow()
  })

  it('rejects part of a filament wall', () => {
    expect(() => priceCalculatorSettingsSchema.parse({ ...DEFAULT_PRICE_CALCULATOR_SETTINGS, filamentWalls: 2.5 })).toThrow()
  })

  it('rejects filament infill above 100%', () => {
    expect(() => priceCalculatorSettingsSchema.parse({ ...DEFAULT_PRICE_CALCULATOR_SETTINGS, filamentInfillPercent: 101 })).toThrow()
  })

  it('rejects an unknown currency', () => {
    expect(() => priceCalculatorSettingsSchema.parse({ ...DEFAULT_PRICE_CALCULATOR_SETTINGS, currency: 'XYZ' })).toThrow()
  })

  it('drops the material and equipment costs older settings stored', () => {
    expect(priceCalculatorSettingsSchema.parse({ ...DEFAULT_PRICE_CALCULATOR_SETTINGS, resinPricePerLitre: 70, printerCosts: {} })).toEqual(
      DEFAULT_PRICE_CALCULATOR_SETTINGS,
    )
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

    expect([printer(resin).data?.item, printer(filament).data?.item]).toMatchObject([
      { id: 'resin', presetId: 'resin-elegoo-mars-2', widthMm: 100, depthMm: 60, heightMm: 150, printType: 'resin' },
      { id: 'filament', widthMm: 220, depthMm: 220, heightMm: 250, printType: 'filament' },
    ])
  })

  it('keeps a printer purchase price, lifespan, and add-on modules', () => {
    const rs = {
      id: 'rs',
      name: 'Reflex RS',
      printType: 'resin',
      purchasePrice: 2500,
      lifespanHours: 10_000,
      addOnPresetIds: ['accessory-heygears-pulsing-release-module'],
    }
    expect(printer(rs).data?.item).toMatchObject(rs)
  })

  it('keeps a printer’s purchase date', () => {
    expect(printer({ id: 'rs', name: 'Reflex RS', printType: 'resin', purchasedOn: '2025-03-14' }).data?.item).toMatchObject({
      purchasedOn: '2025-03-14',
    })
  })

  it('rejects a purchase date that is not a calendar day', () => {
    expect(printer({ id: 'rs', name: 'Reflex RS', printType: 'resin', purchasedOn: '2025-02-30' }).success).toBe(false)
  })

  it('rejects a printer purchase date in the future', () => {
    expect(printer({ id: 'rs', name: 'Reflex RS', printType: 'resin', purchasedOn: '2099-01-01' }).success).toBe(false)
  })

  it('rejects a wash station as a printer add-on', () => {
    expect(
      printer({ id: 'rs', name: 'Reflex RS', printType: 'resin', addOnPresetIds: ['postprocess-formlabs-form-wash-v2'] }).success,
    ).toBe(false)
  })

  it('rejects the same add-on twice', () => {
    const addOn = 'accessory-heygears-pulsing-release-module'
    expect(printer({ id: 'rs', name: 'Reflex RS', printType: 'resin', addOnPresetIds: [addOn, addOn] }).success).toBe(false)
  })
})

describe('email sender schema', () => {
  it('accepts an empty sender to restore the server default', () => {
    expect(emailSenderSchema.safeParse({ name: '', replyTo: '' }).success).toBe(true)
  })

  it('normalizes the reply-to address', () => {
    expect(emailSenderSchema.parse({ name: 'Atelier', replyTo: 'Shop@Example.com' }).replyTo).toBe('shop@example.com')
  })

  it('rejects a sender name that would split the From header', () => {
    expect(emailSenderSchema.safeParse({ name: 'Atelier\nBcc: x@example.com', replyTo: '' }).success).toBe(false)
  })

  it('rejects a reply-to that is not an email address', () => {
    expect(emailSenderSchema.safeParse({ name: '', replyTo: 'not-an-email' }).success).toBe(false)
  })
})

describe('email template schema', () => {
  it('accepts a template for a known email', () => {
    expect(emailTemplateSchema.safeParse({ kind: 'invite', template: { subject: 'Hi', html: '<p>{{link}}</p>' } }).success).toBe(true)
  })

  it('accepts clearing a template', () => {
    expect(emailTemplateSchema.safeParse({ kind: 'print-ready', template: null }).success).toBe(true)
  })

  it('rejects an unknown email', () => {
    expect(emailTemplateSchema.safeParse({ kind: 'password-reset', template: null }).success).toBe(false)
  })

  it('rejects an empty body', () => {
    expect(emailTemplateSchema.safeParse({ kind: 'invite', template: { subject: 'Hi', html: '  ' } }).success).toBe(false)
  })

  it('accepts a template at the placeholder limit', () => {
    const html = '{{link}}'.repeat(MAX_EMAIL_TEMPLATE_PLACEHOLDERS - 1)
    expect(emailTemplateSchema.safeParse({ kind: 'invite', template: { subject: '{{workspace}}', html } }).success).toBe(true)
  })

  it('rejects a template over the placeholder limit', () => {
    const html = '{{link}}'.repeat(MAX_EMAIL_TEMPLATE_PLACEHOLDERS)
    expect(emailTemplateSchema.safeParse({ kind: 'invite', template: { subject: '{{workspace}}', html } }).success).toBe(false)
  })
})

describe('OIDC account creation settings', () => {
  it.each([true, false])('accepts account creation set to %s', (allowSignup) => {
    expect(
      socialProviderSettingsSchema.parse({
        provider: 'oidc',
        clientId: 'id',
        clientSecret: '',
        issuer: 'https://id.example.com',
        scopes: 'openid email',
        name: 'SSO',
        allowSignup,
      }),
    ).toMatchObject({ allowSignup })
  })
})

describe('consumables schema', () => {
  const consumable = (item: unknown) => inventoryItemSchema.safeParse({ inventory: 'consumables', item })
  const tank = { id: 'tank', kind: 'part', name: 'Resin tank', printType: 'resin', price: 60, lifespan: 200, lifespanUnit: 'plates' }

  it('accepts resins, filaments, and wear parts', () => {
    expect(
      [
        { id: 'grey', kind: 'resin', name: 'Grey', pricePerLitre: 50, densityGramsPerMl: 1.1 },
        { id: 'pla', kind: 'filament', name: 'PLA', pricePerKg: 20 },
        tank,
      ].every((item) => consumable(item).success),
    ).toBe(true)
  })

  it('rejects a wear part that never wears out', () => {
    expect(consumable({ ...tank, lifespan: 0 }).success).toBe(false)
  })

  it('rejects a consumable without a name', () => {
    expect(consumable({ ...tank, name: ' ' }).success).toBe(false)
  })

  it('keeps the printer model a wear part belongs to', () => {
    expect(consumable({ ...tank, printerPresetId: 'resin-formlabs-form-4' }).data?.item).toMatchObject({
      printerPresetId: 'resin-formlabs-form-4',
    })
  })

  it('keeps the custom printer a wear part belongs to', () => {
    expect(consumable({ ...tank, printerId: 'printer-1' }).data?.item).toMatchObject({
      printerId: 'printer-1',
    })
  })

  it('accepts a supply priced by the litre', () => {
    expect(consumable({ id: 'ipa', kind: 'supply', name: 'IPA', unit: 'ml', price: 8 }).success).toBe(true)
  })

  it('keeps the catalogue supply a supply was added from', () => {
    expect(
      consumable({ id: 'ipa', kind: 'supply', name: 'IPA', unit: 'ml', price: 8, supplyPresetId: 'supply-isopropyl-alcohol' }).data?.item,
    ).toMatchObject({ supplyPresetId: 'supply-isopropyl-alcohol' })
  })

  it('rejects a supply without a unit', () => {
    expect(consumable({ id: 'ipa', kind: 'supply', name: 'IPA', price: 8 }).success).toBe(false)
  })

  it('keeps a minimum stock', () => {
    expect(consumable({ ...tank, minimumStock: 2 }).data?.item).toMatchObject({ minimumStock: 2 })
  })

  it('rejects a negative minimum stock', () => {
    expect(consumable({ ...tank, minimumStock: -1 }).success).toBe(false)
  })

  it('drops a stored list of printer models from a wear part', () => {
    expect(consumable({ ...tank, printerPresetIds: ['resin-formlabs-form-4'] }).data?.item).not.toHaveProperty('printerPresetIds')
  })
})

describe('equipment schema', () => {
  const equipment = (item: unknown) => inventoryItemSchema.safeParse({ inventory: 'equipment', item })
  const wash = {
    id: 'wash',
    name: 'Form Wash',
    kind: 'wash',
    stage: 'finishing',
    printType: 'resin',
    powerWatts: 50,
    minutesPerUse: 10,
    supplies: [{ consumableId: 'ipa', amountPerUse: 1 }],
  }

  it('accepts a wash station with a supply', () => {
    expect(equipment(wash).success).toBe(true)
  })

  it('keeps a purchase date', () => {
    expect(equipment({ ...wash, purchasedOn: '2024-06-01' }).data?.item).toMatchObject({ purchasedOn: '2024-06-01' })
  })

  it('rejects an equipment purchase date in the future', () => {
    expect(equipment({ ...wash, purchasedOn: '2099-01-01' }).success).toBe(false)
  })

  it('keeps a supply whose consumable it cannot check', () => {
    expect(equipment(wash).data?.item).toMatchObject({ supplies: [{ consumableId: 'ipa', amountPerUse: 1 }] })
  })

  it('rejects the same supply listed twice', () => {
    expect(equipment({ ...wash, supplies: [...wash.supplies, ...wash.supplies] }).success).toBe(false)
  })

  it('rejects a supply used up in no amount', () => {
    expect(equipment({ ...wash, supplies: [{ consumableId: 'ipa', amountPerUse: 0 }] }).success).toBe(false)
  })

  it('rejects an unknown workflow stage', () => {
    expect(equipment({ ...wash, stage: 'printing' }).success).toBe(false)
  })

  it('rejects equipment without a name', () => {
    expect(equipment({ ...wash, name: ' ' }).success).toBe(false)
  })
})

describe('bulk board actions', () => {
  const cards = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `request-${index}`, status: 'queue', count: 1 }))
  const bulk = {
    archive: (count: number) => archiveRequestsSchema.safeParse({ ids: cards(count).map(({ id }) => id) }),
    delete: (count: number) => deleteRequestsSchema.safeParse({ deletions: cards(count) }),
    move: (count: number) =>
      moveCopiesBatchSchema.safeParse({ moves: cards(count).map(({ id }) => ({ id, from: 'queue', to: 'printing', count: 1 })) }),
    tag: (count: number) =>
      updatePrintCopyTagsSchema.safeParse({
        addTagIds: [],
        removeTagIds: [],
        items: cards(count).map(({ id }) => ({ requestId: id, status: 'queue', count: 1 })),
      }),
  }

  it.each(Object.entries(bulk))('takes a whole selection up to the limit to %s', (_, parse) => {
    expect(parse(MAX_BULK_CARDS).success).toBe(true)
  })

  it.each(Object.entries(bulk))('refuses more than the limit to %s', (_, parse) => {
    expect(parse(MAX_BULK_CARDS + 1).success).toBe(false)
  })
})

describe('Spoolman ingest schema', () => {
  const spool = {
    id: 4,
    remaining_weight: 812.5,
    used_weight: 187.5,
    archived: false,
    filament: {
      id: 2,
      name: 'Matte Charcoal',
      material: 'PLA',
      color_hex: '000000',
      external_id: 'bambulab_pla_mattecharcoal_1000_175_n',
      vendor: { id: 1, name: 'Bambu Lab' },
    },
  }

  it('reads every spool as a replacement', () => {
    expect(spoolmanIngestSchema.parse({ spools: [spool] })).toEqual({
      replace: [
        {
          id: 4,
          filamentId: 2,
          filamentName: 'Matte Charcoal',
          vendor: 'Bambu Lab',
          material: 'PLA',
          colourHex: '#000000',
          externalId: 'bambulab_pla_mattecharcoal_1000_175_n',
          remainingGrams: 812.5,
          archived: false,
        },
      ],
    })
  })

  it('reads a Spoolman websocket event for one spool', () => {
    expect(spoolmanIngestSchema.parse({ type: 'updated', resource: 'spool', date: '2026-11-22T08:00:00Z', payload: spool })).toMatchObject({
      upsert: { id: 4 },
    })
  })

  it('reads a deleted spool event as a removal', () => {
    expect(spoolmanIngestSchema.parse({ type: 'deleted', resource: 'spool', payload: spool })).toEqual({ remove: 4 })
  })

  it('takes a spool Spoolman sent without a weight or colour', () => {
    expect(spoolmanIngestSchema.parse({ spools: [{ id: 5, filament: { id: 3 } }] })).toEqual({
      replace: [{ id: 5, filamentId: 3, archived: false }],
    })
  })

  it('rejects a colour that is not hex', () => {
    expect(spoolmanIngestSchema.safeParse({ spools: [{ ...spool, filament: { ...spool.filament, color_hex: 'black' } }] }).success).toBe(
      false,
    )
  })

  it('rejects the same spool sent twice', () => {
    expect(spoolmanIngestSchema.safeParse({ spools: [spool, spool] }).success).toBe(false)
  })

  it('rejects events for other resources', () => {
    expect(spoolmanIngestSchema.safeParse({ type: 'updated', resource: 'vendor', payload: { id: 1 } }).success).toBe(false)
  })
})
