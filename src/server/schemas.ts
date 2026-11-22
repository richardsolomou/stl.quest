import { z } from 'zod'
import { isSlicerFor, SLICER_IDS } from '../core/slicers'
import { notificationKinds, type NotificationKind } from '../core/notifications'
import { onboardingTaskIds } from '../core/onboarding'
import { isPastPurchaseDate } from '../core/maintenance'
import { MAX_AUTO_ARCHIVE_DAYS } from '../core/autoArchive'
import { MAX_COVER_BYTES } from '../core/coverImage'
import {
  MAX_REQUEST_NAME_LENGTH,
  MAX_REQUEST_NOTES_LENGTH,
  MAX_BULK_CARDS,
  MAX_REQUEST_QUANTITY,
  MAX_REQUEST_SOURCE_URL_LENGTH,
  MIN_REQUEST_QUANTITY,
  validSourceUrl,
} from '../core/request'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../core/security'
import { CLOUD_STORAGE_PROVIDERS, normalizeOidcIssuer, OIDC_NAME_MAX_LENGTH, SOCIAL_AUTH_PROVIDERS } from '../core/auth'
import { MAX_USER_NAME_LENGTH, normalizeEmail } from '../core/identity'
import { MAX_PRINT_GROUP_NAME_LENGTH } from '../core/printGroups'
import { PRINT_TYPES, printGroupColors, REQUEST_SORTS } from '../core/types'
import { MAX_WORKSPACE_NAME_LENGTH } from '../core/workspaces'
import { MAX_SPOOLMAN_SPOOLS, type SpoolmanChange } from '../core/spoolman'
import type { BambuddyEvent } from '../core/printJobs'
import { workflow } from '../core/workflow'
import { MAX_CONSUMABLES, SUPPLY_UNITS } from '../core/consumables'
import { ORDER_VENDORS } from '../core/orders/orderEmail'
import type { OrderRestockInput } from '../core/orders/orderRestock'
import { isPrinterAddOn } from '../core/equipmentPresets'
import { EQUIPMENT_KINDS, EQUIPMENT_STAGES, MAX_EQUIPMENT } from '../core/equipment'
import { INVENTORY_KINDS } from '../core/inventory'
import { PRINT_TYPE_CHOICES } from '../core/printTypes'
import { USAGE_TRACKING_SOURCES } from '../core/usageTracking'
import { PRICE_CALCULATOR_CURRENCIES, PRICE_CALCULATOR_MAXIMUMS } from '../core/priceCalculator'
import { MATERIAL_ESTIMATE_LIMITS } from '../core/printEstimates'
import { MAX_USAGE_LIST, USAGE_OUTCOMES, type StepUsageInput, type StockMovementInput, type UsageFilters } from '../core/usage'
import { MAX_PLATE_FILAMENTS, MAX_PLATE_OBJECTS, MAX_PLATE_PRINTS, type PlateRecordInput } from '../core/plates'
import {
  emailTemplateKinds,
  MAX_EMAIL_LOGO_BYTES,
  MAX_EMAIL_ADDRESS_LENGTH,
  MAX_EMAIL_SENDER_NAME_LENGTH,
  emailTemplatePlaceholderCount,
  MAX_EMAIL_TEMPLATE_HTML_LENGTH,
  MAX_EMAIL_TEMPLATE_PLACEHOLDERS,
  MAX_EMAIL_TEMPLATE_SUBJECT_LENGTH,
  type EmailTemplateKind,
} from '../core/email'

const purchaseDate = z.iso.date().refine((date) => isPastPurchaseDate(date, Date.now()), 'purchase date is in the future')

const id = z.string().min(1).max(100)
export const removeAdminWorkspaceMemberSchema = z.object({ id, userId: id })
export const addAdminWorkspaceMemberSchema = z.object({ id, userId: id, role: z.enum(['admin', 'member']) })
const statusId = id
const inviteToken = z.string().min(1).max(100)
const printGroupName = z.string().trim().min(1).max(MAX_PRINT_GROUP_NAME_LENGTH)
export const workspaceNameSchema = z.string().trim().min(1).max(MAX_WORKSPACE_NAME_LENGTH)
export const workspaceNameConfirmationSchema = z.string().max(MAX_WORKSPACE_NAME_LENGTH)
const optionalSourceUrl = z
  .string()
  .max(MAX_REQUEST_SOURCE_URL_LENGTH)
  .refine((value) => value.trim() === '' || validSourceUrl(value.trim()), 'source URL must be an http(s) link')
const requiredSourceUrl = z
  .string()
  .trim()
  .min(1)
  .max(MAX_REQUEST_SOURCE_URL_LENGTH)
  .refine(validSourceUrl, 'source URL must be an http(s) link')

export const createInviteSchema = z.object({
  role: z.enum(['requester', 'admin']),
  label: z.string().max(100).optional(),
  email: z.string().trim().email().max(254).transform(normalizeEmail).optional(),
})

export const idSchema = z.object({ id })
// Bounded as base64 text, so an oversized cover is refused before it is decoded.
const coverImage = z
  .string()
  .max(Math.ceil(MAX_COVER_BYTES / 3) * 4)
  .base64()
export const createLinkedRequestSchema = z.object({
  name: z.string().trim().min(1).max(MAX_REQUEST_NAME_LENGTH),
  quantity: z.number().int().min(MIN_REQUEST_QUANTITY).max(MAX_REQUEST_QUANTITY),
  notes: z.string().trim().max(MAX_REQUEST_NOTES_LENGTH).optional(),
  sourceUrl: requiredSourceUrl,
  requestedPrintType: z.enum(PRINT_TYPES),
  cover: coverImage.optional(),
})
export const requestCoverSchema = z.object({ id, image: coverImage })
export const inviteInfoSchema = z.object({ token: inviteToken })
export const beginProviderInviteSchema = z.object({ token: inviteToken, provider: z.enum(SOCIAL_AUTH_PROVIDERS) })

export const acceptInviteSchema = z.object({
  token: inviteToken,
  name: z.string().trim().min(1).max(MAX_USER_NAME_LENGTH),
  email: z.email().max(254).transform(normalizeEmail),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
})

export const telemetrySettingsSchema = z.object({ enabled: z.boolean() })
export const selfSignupSettingsSchema = z.object({ enabled: z.boolean() })
const supportsAndWastePercentSchema = z
  .number()
  .min(MATERIAL_ESTIMATE_LIMITS.supportsAndWastePercent.min)
  .max(MATERIAL_ESTIMATE_LIMITS.supportsAndWastePercent.max)
// A stripping object, never strict: settings stored by older releases carry extra fields and must still load.
export const priceCalculatorSettingsSchema = z.object({
  currency: z.enum(PRICE_CALCULATOR_CURRENCIES),
  electricityCountryCode: z.string().trim().min(1).max(20).optional(),
  electricityPricePerKwh: z.number().nonnegative().max(PRICE_CALCULATOR_MAXIMUMS.electricityPricePerKwh),
  labourCostPerHour: z.number().nonnegative().max(PRICE_CALCULATOR_MAXIMUMS.labourCostPerHour),
  failureAllowancePercent: z.number().nonnegative().max(PRICE_CALCULATOR_MAXIMUMS.failureAllowancePercent),
  markupPercent: z.number().nonnegative().max(PRICE_CALCULATOR_MAXIMUMS.markupPercent),
  supportsAndWastePercent: z.object({ resin: supportsAndWastePercentSchema, filament: supportsAndWastePercentSchema }),
  resinPerPartMl: z.number().min(MATERIAL_ESTIMATE_LIMITS.resinPerPartMl.min).max(MATERIAL_ESTIMATE_LIMITS.resinPerPartMl.max),
  filamentInfillPercent: z
    .number()
    .min(MATERIAL_ESTIMATE_LIMITS.filamentInfillPercent.min)
    .max(MATERIAL_ESTIMATE_LIMITS.filamentInfillPercent.max),
  filamentWalls: z.int().min(MATERIAL_ESTIMATE_LIMITS.filamentWalls.min).max(MATERIAL_ESTIMATE_LIMITS.filamentWalls.max),
})
const consumableBaseSchema = {
  id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(120),
  minimumStock: z.number().positive().max(10_000_000).optional(),
  packSize: z.number().positive().max(10_000_000).optional(),
  storeId: z.string().trim().min(1).max(200).optional(),
}
const filamentConsumableSchema = z.object({
  ...consumableBaseSchema,
  kind: z.literal('filament'),
  filamentPresetId: z.string().trim().min(1).max(200).optional(),
  colour: z
    .object({
      name: z.string().trim().min(1).max(60),
      hex: z.string().regex(/^#[0-9a-f]{6}$/i),
    })
    .optional(),
  pricePerKg: z.number().positive().max(100_000),
  slicer: z
    .enum(SLICER_IDS)
    .refine((slicer) => isSlicerFor(slicer, 'filament'), 'not a filament slicer')
    .optional(),
})
const consumableSchema = z.discriminatedUnion('kind', [
  z.object({
    ...consumableBaseSchema,
    kind: z.literal('resin'),
    resinPresetId: z.string().trim().min(1).max(200).optional(),
    pricePerLitre: z.number().positive().max(100_000),
    densityGramsPerMl: z.number().positive().max(100),
    slicer: z
      .enum(SLICER_IDS)
      .refine((slicer) => isSlicerFor(slicer, 'resin'), 'not a resin slicer')
      .optional(),
  }),
  filamentConsumableSchema,
  z.object({
    ...consumableBaseSchema,
    kind: z.literal('part'),
    printType: z.enum(PRINT_TYPES),
    price: z.number().nonnegative().max(1_000_000),
    lifespan: z.number().positive().max(10_000_000),
    lifespanUnit: z.enum(['plates', 'hours']),
    printerPresetId: z.string().trim().min(1).max(200).optional(),
    printerId: z.string().trim().min(1).max(200).optional(),
    partPresetId: z.string().trim().min(1).max(200).optional(),
  }),
  z.object({
    ...consumableBaseSchema,
    kind: z.literal('supply'),
    unit: z.enum(SUPPLY_UNITS),
    price: z.number().nonnegative().max(1_000_000),
    supplyPresetId: z.string().trim().min(1).max(200).optional(),
  }),
])
const equipmentItemSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(120),
    presetId: z.string().trim().min(1).max(200).optional(),
    kind: z.enum(EQUIPMENT_KINDS),
    stage: z.enum(EQUIPMENT_STAGES),
    printType: z.enum(PRINT_TYPES).optional(),
    powerWatts: z.number().nonnegative().max(100_000),
    minutesPerUse: z.number().nonnegative().max(10_080),
    supplies: z
      .array(z.object({ consumableId: z.string().trim().min(1).max(200), amountPerUse: z.number().positive().max(1_000_000) }))
      .max(MAX_CONSUMABLES),
    purchasePrice: z.number().nonnegative().max(10_000_000).optional(),
    lifespanHours: z.number().positive().max(10_000_000).optional(),
    purchasedOn: purchaseDate.optional(),
  })
  .superRefine(({ supplies }, context) => {
    const supplied = new Set<string>()
    for (const [index, supply] of supplies.entries()) {
      if (supplied.has(supply.consumableId))
        context.addIssue({ code: 'custom', path: ['supplies', index, 'consumableId'], message: 'each supply is listed once' })
      supplied.add(supply.consumableId)
    }
  })
export const emailLogoSchema = z.object({
  data: z
    .string()
    .max(Math.ceil(MAX_EMAIL_LOGO_BYTES / 3) * 4)
    .base64()
    .nullable(),
})
export const emailSenderSchema = z.object({
  name: z
    .string()
    .trim()
    .max(MAX_EMAIL_SENDER_NAME_LENGTH)
    .regex(/^[^\r\n]*$/),
  replyTo: z.union([z.literal(''), z.email().max(MAX_EMAIL_ADDRESS_LENGTH).transform(normalizeEmail)]),
})
export const emailTemplateSchema = z.object({
  kind: z.enum(emailTemplateKinds.map((kind) => kind.id) as [EmailTemplateKind, ...EmailTemplateKind[]]),
  template: z
    .object({
      subject: z.string().trim().min(1).max(MAX_EMAIL_TEMPLATE_SUBJECT_LENGTH),
      html: z.string().trim().min(1).max(MAX_EMAIL_TEMPLATE_HTML_LENGTH),
    })
    .refine(
      (template) => emailTemplatePlaceholderCount(template) <= MAX_EMAIL_TEMPLATE_PLACEHOLDERS,
      `use at most ${MAX_EMAIL_TEMPLATE_PLACEHOLDERS} placeholders`,
    )
    .nullable(),
})
export const notificationPreferenceSchema = z.object({
  kind: z.enum(notificationKinds.map((kind) => kind.id) as [NotificationKind, ...NotificationKind[]]),
  enabled: z.boolean(),
})
const onboardingTaskSchema = z.enum(onboardingTaskIds)
export const onboardingUpdateSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('complete'), task: onboardingTaskSchema }),
  z.object({ operation: z.literal('skip'), task: onboardingTaskSchema }),
  z.object({ operation: z.literal('restore'), task: onboardingTaskSchema }),
  z.object({ operation: z.literal('celebrate'), tasks: z.array(onboardingTaskSchema).min(1) }),
])
export const boardSettingsSchema = z
  .object({
    privateRequests: z.boolean().optional(),
    autoArchiveDays: z.number().int().min(1).max(MAX_AUTO_ARCHIVE_DAYS).nullable().optional(),
    manualPrinterAssignment: z.boolean().optional(),
  })
  .refine(
    (value) => value.privateRequests !== undefined || value.autoArchiveDays !== undefined || value.manualPrinterAssignment !== undefined,
  )

export const printTypeChoiceSchema = z.object({ choice: z.enum(PRINT_TYPE_CHOICES) })

export const usageTrackingSchema = z.object({ enabled: z.boolean(), source: z.enum(USAGE_TRACKING_SOURCES) })

export const memberRequestVisibilitySchema = z.object({
  userId: z.string().min(1),
  visibility: z.enum(['default', 'own', 'all']),
})

const printerProfileSchema = z.object({
  id: id,
  presetId: id.optional(),
  widthMm: z.number().positive().max(10_000).optional(),
  depthMm: z.number().positive().max(10_000).optional(),
  heightMm: z.number().positive().max(10_000).optional(),
  name: z.string().trim().min(1).max(100),
  printType: z.enum(PRINT_TYPES),
  purchasePrice: z.number().positive().max(10_000_000).optional(),
  lifespanHours: z.number().positive().max(10_000_000).optional(),
  purchasedOn: purchaseDate.optional(),
  powerWatts: z.number().positive().max(100_000).optional(),
  slicer: z.enum(SLICER_IDS).optional(),
  addOnPresetIds: z
    .array(id.refine(isPrinterAddOn, 'not a printer add-on'))
    .max(20)
    .refine((ids) => new Set(ids).size === ids.length, 'add-ons must be unique')
    .optional(),
})

const storeSchema = z.object({
  id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(100),
  shippingCost: z.number().nonnegative().max(100_000).optional(),
  freeShippingOver: z.number().positive().max(1_000_000).optional(),
})

/** One printer, piece of equipment, consumable, or store; whether it is archived is changed only by `inventoryArchiveSchema`. */
export const inventoryItemSchema = z.discriminatedUnion('inventory', [
  z.object({ inventory: z.literal('printers'), item: printerProfileSchema }),
  z.object({ inventory: z.literal('equipment'), item: equipmentItemSchema }),
  z.object({ inventory: z.literal('consumables'), item: consumableSchema }),
  z.object({ inventory: z.literal('stores'), item: storeSchema }),
])
export const inventoryItemRefSchema = z.object({
  inventory: z.enum(INVENTORY_KINDS),
  id: z.string().trim().min(1).max(200),
})
export const inventoryArchiveSchema = inventoryItemRefSchema.extend({ archived: z.boolean() })

/** Several new consumables of one kind, such as the colours of one filament, each optionally counted at the same amount. */
export const createConsumablesSchema = z.object({
  items: z
    .array(consumableSchema)
    .min(1)
    .max(MAX_CONSUMABLES)
    .refine((items) => new Set(items.map((item) => item.id)).size === items.length, 'IDs must be unique')
    .refine((items) => items.every(({ kind }) => kind === items[0].kind), 'items must be of one kind'),
  onHand: z.number().positive().max(1_000_000).optional(),
})
export const shareFilamentPriceSchema = z.object({ consumableId: z.string().trim().min(1).max(200) })

export const passwordAuthSettingsSchema = z.object({ enabled: z.boolean() })
export const setOwnPasswordSchema = z.object({ password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH) })
export const changeOwnEmailSchema = z.object({
  email: z.email().max(254).transform(normalizeEmail),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
})
export const unlinkOwnAccountSchema = z.object({ provider: z.enum(['credential', ...SOCIAL_AUTH_PROVIDERS]) })
const socialProvider = z.enum(SOCIAL_AUTH_PROVIDERS)
const socialProviderCredentials = {
  clientId: z.string().trim().min(1).max(500),
  clientSecret: z.string().max(1000),
}
export const socialProviderSettingsSchema = z.discriminatedUnion('provider', [
  z.object({ provider: z.enum(['google', 'discord']), ...socialProviderCredentials }),
  z.object({
    provider: z.literal('oidc'),
    allowSignup: z.boolean().optional(),
    ...socialProviderCredentials,
    issuer: z
      .string()
      .max(500)
      .transform((value, ctx) => {
        const issuer = normalizeOidcIssuer(value)
        if (!issuer) ctx.addIssue({ code: 'custom', message: 'issuer must be an http or https URL' })
        return issuer ?? ''
      }),
    scopes: z.string().max(500),
    name: z.string().trim().max(OIDC_NAME_MAX_LENGTH),
  }),
])
export const socialProviderEnabledSchema = z.object({ provider: socialProvider, enabled: z.boolean() })

const emailFrom = z.string().trim().min(3).max(500)
export const smtpEmailSettingsSchema = z.object({
  from: emailFrom,
  host: z.string().trim().min(1).max(500),
  port: z.number().int().min(1).max(65_535),
  secure: z.boolean(),
  user: z.string().trim().max(500).optional(),
  password: z.string().max(1000).optional(),
})

const requestSortSchema = z.enum(REQUEST_SORTS)

export const requestFiltersSchema = z
  .object({
    query: z.string().trim().max(200).optional(),
    requester: z.string().trim().max(100).optional(),
    minQuantity: z.number().int().min(MIN_REQUEST_QUANTITY).max(MAX_REQUEST_QUANTITY).optional(),
    maxQuantity: z.number().int().min(MIN_REQUEST_QUANTITY).max(MAX_REQUEST_QUANTITY).optional(),
    minEstimatedMaterial: z.number().nonnegative().max(1_000_000).optional(),
    maxEstimatedMaterial: z.number().positive().max(1_000_000).optional(),
    createdAfter: z.number().int().nonnegative().optional(),
    createdBefore: z.number().int().nonnegative().optional(),
    updatedAfter: z.number().int().nonnegative().optional(),
    updatedBefore: z.number().int().nonnegative().optional(),
    hasNotes: z.boolean().optional(),
    hasSource: z.boolean().optional(),
    hasThumbnail: z.boolean().optional(),
    hasPreview: z.boolean().optional(),
    printType: z.enum(PRINT_TYPES).optional(),
    printerId: id.nullable().optional(),
    sort: requestSortSchema.optional(),
    archived: z.boolean().optional(),
  })
  .superRefine((filters, context) => {
    if (filters.minQuantity !== undefined && filters.maxQuantity !== undefined && filters.minQuantity > filters.maxQuantity) {
      context.addIssue({ code: 'custom', path: ['minQuantity'], message: 'minimum quantity must not exceed maximum quantity' })
    }
    if (
      filters.minEstimatedMaterial !== undefined &&
      filters.maxEstimatedMaterial !== undefined &&
      filters.minEstimatedMaterial > filters.maxEstimatedMaterial
    ) {
      context.addIssue({ code: 'custom', path: ['minEstimatedMaterial'], message: 'minimum material must not exceed maximum material' })
    }
    if (filters.createdAfter !== undefined && filters.createdBefore !== undefined && filters.createdAfter > filters.createdBefore) {
      context.addIssue({ code: 'custom', path: ['createdAfter'], message: 'created start must not exceed created end' })
    }
    if (filters.updatedAfter !== undefined && filters.updatedBefore !== undefined && filters.updatedAfter > filters.updatedBefore) {
      context.addIssue({ code: 'custom', path: ['updatedAfter'], message: 'updated start must not exceed updated end' })
    }
  })

const localStorageSchema = z.object({
  adapter: z.literal('local'),
  root: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .refine((value) => value.startsWith('/'), 'folder must be an absolute path'),
})
const managedStorageSchema = z.object({ adapter: z.literal('managed') })

const cloudStorageLayoutSchema = z.literal('workspace-root-v1').optional()
const dropboxStorageSchema = z.object({ adapter: z.literal('dropbox'), root: z.string().trim().max(500), layout: cloudStorageLayoutSchema })
const googleDriveStorageSchema = z.object({
  adapter: z.literal('google-drive'),
  root: z.string().trim().max(500),
  layout: cloudStorageLayoutSchema,
})
const oneDriveStorageSchema = z.object({
  adapter: z.literal('onedrive'),
  root: z.string().trim().max(500),
  layout: cloudStorageLayoutSchema,
})
const boxStorageSchema = z.object({ adapter: z.literal('box'), root: z.string().trim().max(500), layout: cloudStorageLayoutSchema })

const webDAVStorageSchema = z.object({
  adapter: z.literal('webdav'),
  endpoint: z.string().trim().refine(validSourceUrl, 'endpoint must be an http(s) URL'),
  root: z.string().trim().max(500),
  username: z.string().trim().min(1).max(256),
  password: z.string().max(512),
})

const s3StorageSchema = z.object({
  adapter: z.literal('s3'),
  endpoint: z.string().trim().refine(validSourceUrl, 'endpoint must be an http(s) URL'),
  region: z.string().trim().max(64),
  bucket: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'invalid bucket name'),
  prefix: z.string().max(200).optional(),
  accessKeyId: z.string().trim().min(1).max(128),
  secretAccessKey: z.string().max(256),
  forcePathStyle: z.boolean(),
})

export const storageSettingsSchema = z.discriminatedUnion('adapter', [
  managedStorageSchema,
  localStorageSchema,
  webDAVStorageSchema,
  dropboxStorageSchema,
  googleDriveStorageSchema,
  oneDriveStorageSchema,
  boxStorageSchema,
  s3StorageSchema,
])
export const storageChangeSchema = z.intersection(
  storageSettingsSchema,
  z.object({ destinationAction: z.enum(['preserve', 'clear-all']).optional() }),
)
export const storageDirectorySchema = z.object({ path: z.string().trim().min(1).max(4_096) })
const cloudStorageProviderSchema = z.enum(CLOUD_STORAGE_PROVIDERS)
export const cloudStorageAppSchema = z.object({
  provider: cloudStorageProviderSchema,
  clientId: z.string().trim().min(1).max(256),
  clientSecret: z.string().max(512),
})
export const cloudConnectionSchema = z.object({
  provider: cloudStorageProviderSchema,
  returnTo: z
    .string()
    .regex(/^\/(?!\/)/)
    .max(500),
})
export const cloudProviderSchema = z.object({ provider: cloudStorageProviderSchema })
export const cloudProviderEnabledSchema = z.object({ provider: cloudStorageProviderSchema, enabled: z.boolean() })

export const moveCopiesSchema = z.object({
  id,
  from: statusId,
  to: statusId,
  count: z.number().int().min(1),
  tagIds: z.array(id).max(100).optional(),
  order: z.number().finite().optional(),
})

export const moveCopiesBatchSchema = z.object({
  moves: z.array(moveCopiesSchema).min(1).max(MAX_BULK_CARDS),
})

export const slicerLinkSchema = z.object({ requestId: id, slicer: z.enum(SLICER_IDS) })

const settingsItemId = z.string().trim().min(1).max(200)
const usageAmount = z.number().positive().max(1_000_000)
export const recordStepUsageSchema = z.object({
  requestId: id,
  stage: z.enum(['printing', 'finishing']),
  copies: z.number().int().min(MIN_REQUEST_QUANTITY).max(MAX_REQUEST_QUANTITY),
  printerId: settingsItemId.optional(),
  consumableId: settingsItemId.optional(),
  equipmentIds: z.array(settingsItemId).max(MAX_EQUIPMENT).optional(),
  outcome: z.enum(USAGE_OUTCOMES).optional(),
}) satisfies z.ZodType<StepUsageInput>
export const recordStockMovementSchema = z.discriminatedUnion('kind', [
  z.object({ consumableId: settingsItemId, kind: z.enum(['restock', 'waste']), amount: usageAmount }),
  z.object({ consumableId: settingsItemId, kind: z.literal('replace'), amount: usageAmount, printerId: settingsItemId.optional() }),
  z.object({ consumableId: settingsItemId, kind: z.literal('correction'), counted: z.number().min(0).max(1_000_000) }),
]) satisfies z.ZodType<StockMovementInput>
/** What confirming a pasted order stores; the email itself never reaches the server. */
export const restockFromOrderSchema = z.object({
  vendor: z.enum(ORDER_VENDORS),
  added: z
    .array(filamentConsumableSchema)
    .max(MAX_CONSUMABLES)
    .refine((items) => new Set(items.map((item) => item.id)).size === items.length, 'IDs must be unique'),
  prices: z.array(z.object({ consumableId: settingsItemId, price: z.number().positive().max(100_000) })).max(MAX_CONSUMABLES),
  restocks: z
    .array(z.object({ consumableId: settingsItemId, amount: usageAmount }))
    .min(1)
    .max(MAX_CONSUMABLES)
    .refine((items) => new Set(items.map(({ consumableId }) => consumableId)).size === items.length, 'one restock per consumable'),
}) satisfies z.ZodType<OrderRestockInput>
export const undoUsageSchema = z.object({ transactionId: id })
export const usageFiltersSchema = z.object({
  requestId: id.optional(),
  consumableId: settingsItemId.optional(),
  printerId: settingsItemId.optional(),
  equipmentId: settingsItemId.optional(),
  from: z.number().int().nonnegative().optional(),
  to: z.number().int().nonnegative().optional(),
  includeUndone: z.boolean().optional(),
  limit: z.number().int().min(1).max(MAX_USAGE_LIST).optional(),
}) satisfies z.ZodType<UsageFilters>

const plateAmount = z.number().min(-1_000_000).max(1_000_000)
const plateMaterialChoice = z.union([
  z.object({ consumableId: settingsItemId }),
  z.object({ name: z.string().trim().min(1).max(120), price: z.number().positive().max(1_000_000).optional() }),
])
export const createPlateSchema = z.object({
  printerId: settingsItemId.optional(),
  otherStuff: z.boolean(),
  items: z
    .array(z.object({ requestId: id, status: statusId, copies: z.number().int().min(MIN_REQUEST_QUANTITY).max(MAX_REQUEST_QUANTITY) }))
    .min(1)
    .max(MAX_PLATE_PRINTS * workflow.statuses.length),
})
export const movePlateSchema = z.object({ plateId: id, to: statusId })
export const printJobIdSchema = z.object({ jobId: id })
export const attachPrintJobSchema = z.union([z.object({ jobId: id, plateId: id }), z.object({ jobId: id, requestId: id })])
export const printJobPersonalSchema = z.object({ jobId: id, personal: z.boolean() })
const plateRecordBase = {
  plateId: id,
  minutes: z.number().min(0).max(1_000_000),
  materials: z.array(plateMaterialChoice).min(1).max(MAX_PLATE_FILAMENTS),
}
export const recordPlateSchema = z.union([
  z.object({
    ...plateRecordBase,
    objects: z.array(z.object({ requestId: id.optional(), amounts: z.array(plateAmount).max(MAX_PLATE_FILAMENTS) })).max(MAX_PLATE_OBJECTS),
    overhead: z.array(plateAmount).max(MAX_PLATE_FILAMENTS),
  }),
  z.object({ ...plateRecordBase, total: z.number().positive().max(1_000_000), otherShare: z.number().min(0).lt(1) }),
]) satisfies z.ZodType<PlateRecordInput>
export const plateIdSchema = z.object({ plateId: id })
export const requestChargeSchema = z.object({ id, amount: z.number().min(0).max(1_000_000_000).nullable() })

export const createPrintGroupSchema = z.object({
  name: printGroupName.optional(),
  parentId: id.optional(),
  status: statusId,
  items: z.array(z.object({ requestId: id, count: z.number().int().min(1) })).max(MAX_BULK_CARDS),
})

export const movePrintGroupSchema = z.object({ id, from: statusId, to: statusId })
export const updatePrintGroupSchema = z.object({
  id,
  name: printGroupName.optional(),
  color: z.enum(printGroupColors).optional(),
  parentId: id.nullable().optional(),
})
export const updatePrintCopyTagsSchema = z.object({
  createTagName: printGroupName.optional(),
  addTagIds: z.array(id).max(100),
  removeTagIds: z.array(id).max(100),
  items: z
    .array(z.object({ requestId: id, status: statusId, count: z.number().int().min(1) }))
    .min(1)
    .max(MAX_BULK_CARDS),
})
export const deletePrintGroupSchema = z.object({ id })
export const reorderPrintGroupItemSchema = z.object({
  groupId: id,
  status: statusId,
  requestId: id,
  targetRequestId: id,
  edge: z.enum(['before', 'after']),
})

export const deleteRequestsSchema = z.object({
  deletions: z
    .array(z.object({ id, status: statusId, count: z.number().int().min(1), tagIds: z.array(id).max(100).optional() }))
    .min(1)
    .max(MAX_BULK_CARDS),
})

export const archiveRequestsSchema = z.object({ ids: z.array(id).min(1).max(MAX_BULK_CARDS) })

export const assignRequestsSchema = z.object({ ids: z.array(id).min(1).max(MAX_BULK_CARDS), printerId: id })

export const reorderRequestSchema = z.object({
  id,
  status: statusId,
  order: z.number().finite(),
})

export const updateRequestSchema = z.object({
  id,
  name: z.string().min(1).max(MAX_REQUEST_NAME_LENGTH).optional(),
  quantity: z.number().int().min(MIN_REQUEST_QUANTITY).max(MAX_REQUEST_QUANTITY).optional(),
  notes: z.string().max(MAX_REQUEST_NOTES_LENGTH).optional(),
  sourceUrl: optionalSourceUrl.optional(),
  requestedPrintType: z.enum(PRINT_TYPES).optional(),
  printerId: id.nullable().optional(),
  estimatedMaterialOverride: z.number().positive().max(1_000_000).nullable().optional(),
  estimatedPrintMinutesOverride: z.number().positive().max(1_000_000).nullable().optional(),
})

export const repeatRequestSchema = z.object({
  id,
  quantity: z.number().int().min(MIN_REQUEST_QUANTITY).max(MAX_REQUEST_QUANTITY),
})

// Bambuddy's generic webhook sends every value as a display string; anything else it adds, such as a photo, is dropped.
const bambuddyText = (max: number) =>
  z
    .union([z.string().max(max), z.number().finite()])
    .nullish()
    .transform((value) => (value === null || value === undefined ? undefined : String(value)))
export const bambuddyEventSchema = z.object({
  event: z.string().min(1).max(64),
  printer: bambuddyText(256),
  filename: bambuddyText(512),
  duration: bambuddyText(64),
  filament_grams: bambuddyText(64),
  filament_details: bambuddyText(2048),
  reason: bambuddyText(1024),
  progress: bambuddyText(16),
  archive_id: bambuddyText(64),
  run_id: bambuddyText(64),
}) satisfies z.ZodType<BambuddyEvent>

// Spoolman's own JSON, so its websocket events and REST responses can be forwarded as they are; it leaves out what is null.
const spoolmanKey = z.number().int().min(0).max(2_147_483_647)
const spoolmanText = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((value) => value?.trim() || undefined)
const spoolmanSpool = z
  .object({
    id: spoolmanKey,
    remaining_weight: z.number().min(-1_000_000).max(1_000_000).nullish(),
    archived: z.boolean().nullish(),
    filament: z.object({
      id: spoolmanKey,
      name: spoolmanText(256),
      material: spoolmanText(64),
      color_hex: z
        .string()
        .regex(/^#?[0-9a-f]{6}([0-9a-f]{2})?$/i)
        .nullish(),
      external_id: spoolmanText(256),
      vendor: z.object({ name: spoolmanText(256) }).nullish(),
    }),
  })
  .transform(({ id: spoolId, remaining_weight, archived, filament }) => ({
    id: spoolId,
    filamentId: filament.id,
    ...(filament.name && { filamentName: filament.name }),
    ...(filament.vendor?.name && { vendor: filament.vendor.name }),
    ...(filament.material && { material: filament.material }),
    ...(filament.color_hex && { colourHex: `#${filament.color_hex.replace('#', '').slice(0, 6).toUpperCase()}` }),
    ...(filament.external_id && { externalId: filament.external_id }),
    ...(typeof remaining_weight === 'number' && { remainingGrams: remaining_weight }),
    archived: archived ?? false,
  }))
export const spoolmanIngestSchema = z.union([
  z
    .object({
      spools: z
        .array(spoolmanSpool)
        .max(MAX_SPOOLMAN_SPOOLS)
        .refine((spools) => new Set(spools.map((spool) => spool.id)).size === spools.length, 'each spool once'),
    })
    .transform(({ spools }) => ({ replace: spools })),
  z
    .object({ type: z.enum(['added', 'updated', 'deleted']), resource: z.literal('spool'), payload: spoolmanSpool })
    .transform(({ type, payload }) => (type === 'deleted' ? { remove: payload.id } : { upsert: payload })),
]) satisfies z.ZodType<SpoolmanChange>
export const linkSpoolmanFilamentSchema = z.object({
  filamentId: spoolmanKey,
  choice: z.union([z.literal('auto'), z.literal('none'), settingsItemId]),
})
