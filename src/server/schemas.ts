import { z } from 'zod'
import { validSourceUrl } from '../core/services'
import { PASSWORD_MIN_LENGTH } from '../core/security'

const id = z.string().min(1).max(100)
const optionalSourceUrl = z
  .string()
  .max(500)
  .refine((value) => value.trim() === '' || validSourceUrl(value.trim()), 'source URL must be an http(s) link')

export const createInviteSchema = z.object({
  role: z.enum(['requester', 'admin']),
  label: z.string().max(100).optional(),
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((value) => value.toLowerCase())
    .optional(),
})

export const idSchema = z.object({ id })
export const inviteInfoSchema = z.object({ token: z.string().min(1).max(100) })
export const beginProviderInviteSchema = z.object({ token: z.string().min(1).max(100), provider: z.enum(['google', 'discord']) })

export const acceptInviteSchema = z.object({
  token: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(100),
  email: z
    .email()
    .max(254)
    .transform((value) => value.trim().toLowerCase()),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(256),
})

export const telemetrySettingsSchema = z.object({ enabled: z.boolean() })
export const boardSettingsSchema = z.object({ privateRequests: z.boolean() })

const printerProfileSchema = z.object({
  id: id,
  name: z.string().trim().min(1).max(100),
  widthMm: z.number().positive().max(10_000),
  depthMm: z.number().positive().max(10_000),
  heightMm: z.number().positive().max(10_000),
  spacingMm: z.number().nonnegative().max(1_000),
  supportMarginMm: z.number().nonnegative().max(1_000),
  adhesionMarginMm: z.number().nonnegative().max(1_000),
  heightAllowanceMm: z.number().nonnegative().max(10_000),
  maxHeightDifferenceMm: z.number().nonnegative().max(10_000),
})

const footprintSchema = z.object({ widthMm: z.number().positive(), depthMm: z.number().positive(), known: z.boolean() })
const plateCandidateSchema = z.object({
  copyId: id,
  requestId: id,
  name: z.string().max(200),
  footprint: footprintSchema,
  estimatedSupportedHeightMm: z.number().nonnegative(),
})
const platePlacementSchema = plateCandidateSchema.extend({
  xMm: z.number().finite(),
  yMm: z.number().finite(),
  rotationZDegrees: z.number().finite(),
})

export const printerProfilesSchema = z.object({ profiles: z.array(printerProfileSchema).min(1).max(50) })
export const plateModelAnalysesSchema = z.object({
  analyses: z
    .array(z.object({ requestId: id, widthMm: z.number().positive(), depthMm: z.number().positive(), heightMm: z.number().positive() }))
    .max(500),
})
export const platePlannerDraftSchema = z.object({
  draft: z.object({
    fingerprint: z.string().min(1).max(100_000),
    printerId: id,
    candidates: z.array(plateCandidateSchema).max(5_000),
    placements: z.array(platePlacementSchema).max(5_000),
    skippedCount: z.number().int().nonnegative(),
    savedAt: z.number().int().nonnegative(),
  }),
})

export const passwordAuthSettingsSchema = z.object({ enabled: z.boolean() })
export const setOwnPasswordSchema = z.object({ password: z.string().min(PASSWORD_MIN_LENGTH).max(256) })
const socialProvider = z.enum(['google', 'discord'])
export const socialProviderSettingsSchema = z.object({
  provider: socialProvider,
  clientId: z.string().trim().min(1).max(500),
  clientSecret: z.string().max(1000),
})
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

const requestSortSchema = z.enum([
  'board',
  'updated-desc',
  'updated-asc',
  'created-desc',
  'created-asc',
  'name-asc',
  'name-desc',
  'quantity-desc',
  'quantity-asc',
])

export const requestFiltersSchema = z
  .object({
    query: z.string().trim().max(200).optional(),
    requester: z.string().trim().max(100).optional(),
    minQuantity: z.number().int().min(1).max(50).optional(),
    maxQuantity: z.number().int().min(1).max(50).optional(),
    createdAfter: z.number().int().nonnegative().optional(),
    createdBefore: z.number().int().nonnegative().optional(),
    updatedAfter: z.number().int().nonnegative().optional(),
    updatedBefore: z.number().int().nonnegative().optional(),
    hasNotes: z.boolean().optional(),
    hasSource: z.boolean().optional(),
    hasThumbnail: z.boolean().optional(),
    hasPreview: z.boolean().optional(),
    sort: requestSortSchema.optional(),
  })
  .superRefine((filters, context) => {
    if (filters.minQuantity !== undefined && filters.maxQuantity !== undefined && filters.minQuantity > filters.maxQuantity) {
      context.addIssue({ code: 'custom', path: ['minQuantity'], message: 'minimum quantity must not exceed maximum quantity' })
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

export const storageSettingsSchema = z.discriminatedUnion('adapter', [localStorageSchema, s3StorageSchema])

export const moveCopiesSchema = z.object({
  id,
  from: z.string().min(1).max(100),
  to: z.string().min(1).max(100),
  count: z.number().int().min(1),
  order: z.number().finite().optional(),
})

export const reorderRequestSchema = z.object({
  id,
  status: z.string().min(1).max(100),
  order: z.number().finite(),
})

export const updateRequestSchema = z.object({
  id,
  name: z.string().min(1).max(120).optional(),
  quantity: z.number().int().min(1).max(50).optional(),
  requesterName: z.string().max(60).optional(),
  notes: z.string().max(2000).optional(),
  sourceUrl: optionalSourceUrl.optional(),
})
