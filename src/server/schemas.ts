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
export const boardSettingsSchema = z
  .object({
    privateRequests: z.boolean().optional(),
  })
  .refine((value) => value.privateRequests !== undefined)

const printerProfileBaseSchema = z.object({
  id: id,
  presetId: id.optional(),
  widthMm: z.number().positive().max(10_000).optional(),
  depthMm: z.number().positive().max(10_000).optional(),
  heightMm: z.number().positive().max(10_000).optional(),
  name: z.string().trim().min(1).max(100),
  printType: z.enum(['resin', 'filament']),
})

export const printerProfilesSchema = z
  .object({ profiles: z.array(printerProfileBaseSchema).max(50) })
  .superRefine(({ profiles }, context) => {
    const ids = new Set<string>()
    for (const [index, profile] of profiles.entries()) {
      if (ids.has(profile.id)) context.addIssue({ code: 'custom', path: ['profiles', index, 'id'], message: 'printer IDs must be unique' })
      ids.add(profile.id)
    }
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
  'fair',
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
    printType: z.enum(['resin', 'filament']).optional(),
    printerId: id.nullable().optional(),
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

const dropboxStorageSchema = z.object({ adapter: z.literal('dropbox'), root: z.string().trim().max(500) })
const googleDriveStorageSchema = z.object({ adapter: z.literal('google-drive'), root: z.string().trim().max(500) })
const oneDriveStorageSchema = z.object({ adapter: z.literal('onedrive'), root: z.string().trim().max(500) })

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
  localStorageSchema,
  webDAVStorageSchema,
  dropboxStorageSchema,
  googleDriveStorageSchema,
  oneDriveStorageSchema,
  s3StorageSchema,
])
export const storageDirectorySchema = z.object({ path: z.string().trim().min(1).max(4_096) })
export const dropboxConnectionSchema = z.object({
  clientId: z.string().trim().min(1).max(256),
  clientSecret: z.string().max(512),
  returnTo: z
    .string()
    .regex(/^\/(?!\/)/)
    .max(500),
})
export const cloudStorageProviderSchema = z.enum(['dropbox', 'google-drive', 'onedrive'])
export const cloudConnectionSchema = dropboxConnectionSchema.extend({ provider: cloudStorageProviderSchema })
export const cloudProviderSchema = z.object({ provider: cloudStorageProviderSchema })

export const moveCopiesSchema = z.object({
  id,
  from: z.string().min(1).max(100),
  to: z.string().min(1).max(100),
  count: z.number().int().min(1),
  order: z.number().finite().optional(),
})

export const moveCopiesBatchSchema = z.object({
  moves: z.array(moveCopiesSchema).min(1).max(100),
})

export const deleteRequestsSchema = z.object({
  ids: z.array(id).min(1).max(100),
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
  notes: z.string().max(2000).optional(),
  sourceUrl: optionalSourceUrl.optional(),
  requestedPrintType: z.enum(['resin', 'filament']).optional(),
  printerId: id.nullable().optional(),
})
