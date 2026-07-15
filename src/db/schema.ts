import { sql } from 'drizzle-orm'
import { check, customType, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

const isoDate = customType<{ data: Date; driverData: string }>({
  dataType: () => 'text',
  fromDriver: (value) => new Date(value),
  toDriver: (value) => value.toISOString(),
})

export const user = sqliteTable('user', {
  id: text().primaryKey().notNull(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: integer({ mode: 'boolean' }).notNull(),
  image: text(),
  createdAt: isoDate().notNull(),
  updatedAt: isoDate().notNull(),
  role: text({ enum: ['admin', 'requester'] }),
  banned: integer({ mode: 'boolean' }),
  banReason: text(),
  banExpires: isoDate(),
  color: text(),
  twoFactorEnabled: integer({ mode: 'boolean' }).notNull().default(false),
})

export const session = sqliteTable(
  'session',
  {
    id: text().primaryKey().notNull(),
    expiresAt: isoDate().notNull(),
    token: text().notNull().unique(),
    createdAt: isoDate().notNull(),
    updatedAt: isoDate().notNull(),
    ipAddress: text(),
    userAgent: text(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    impersonatedBy: text(),
  },
  (table) => [index('session_userId_idx').on(table.userId)],
)

export const account = sqliteTable(
  'account',
  {
    id: text().primaryKey().notNull(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: isoDate(),
    refreshTokenExpiresAt: isoDate(),
    scope: text(),
    password: text(),
    createdAt: isoDate().notNull(),
    updatedAt: isoDate().notNull(),
  },
  (table) => [index('account_userId_idx').on(table.userId)],
)

export const verification = sqliteTable(
  'verification',
  {
    id: text().primaryKey().notNull(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: isoDate().notNull(),
    createdAt: isoDate().notNull(),
    updatedAt: isoDate().notNull(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
)

export const rateLimit = sqliteTable(
  'rateLimit',
  {
    id: text().primaryKey().notNull(),
    key: text().notNull().unique(),
    count: integer().notNull(),
    lastRequest: integer().notNull(),
  },
  (table) => [index('rateLimit_key_idx').on(table.key)],
)

export const twoFactor = sqliteTable(
  'twoFactor',
  {
    id: text().primaryKey().notNull(),
    secret: text().notNull(),
    backupCodes: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    verified: integer({ mode: 'boolean' }).notNull().default(true),
    failedVerificationCount: integer().notNull().default(0),
    lockedUntil: isoDate(),
  },
  (table) => [index('twoFactor_secret_idx').on(table.secret), index('twoFactor_userId_idx').on(table.userId)],
)

export const requests = sqliteTable(
  'requests',
  {
    id: text().primaryKey(),
    name: text().notNull(),
    fileName: text('file_name').notNull(),
    filePath: text('file_path').notNull(),
    quantity: integer().notNull(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    notes: text(),
    sourceUrl: text('source_url'),
    thumbnailPath: text('thumbnail_path'),
    previewPath: text('preview_path'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    assetsGeneratedAt: integer('assets_generated_at'),
    printerId: text('printer_id'),
    printType: text('print_type', { enum: ['resin', 'filament'] }),
  },
  (table) => [
    check('requests_print_type_check', sql`${table.printType} IN ('resin', 'filament') OR ${table.printType} IS NULL`),
    index('requests_created').on(table.createdAt),
    index('requests_print_type').on(table.printType),
    index('requests_printer_id').on(table.printerId),
    index('requests_owner_user_id').on(table.ownerUserId),
  ],
)

export const requestStatuses = sqliteTable(
  'request_statuses',
  {
    requestId: text('request_id')
      .notNull()
      .references(() => requests.id, { onDelete: 'cascade' }),
    statusId: text('status_id').notNull(),
    quantity: integer().notNull(),
    sortOrder: real('sort_order'),
  },
  (table) => [primaryKey({ columns: [table.requestId, table.statusId] })],
)

export const operations = sqliteTable(
  'operations',
  {
    id: text().primaryKey(),
    kind: text({ enum: ['move', 'delete', 'upload'] }).notNull(),
    requestId: text('request_id'),
    uploadId: text('upload_id'),
    payloadJson: text('payload_json').notNull(),
    state: text({ enum: ['prepared', 'assets_moved', 'committed'] }).notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    check('operations_kind_check', sql`${table.kind} IN ('move', 'delete', 'upload')`),
    check('operations_state_check', sql`${table.state} IN ('prepared', 'assets_moved', 'committed')`),
    index('operations_state').on(table.state, table.createdAt),
    uniqueIndex('operations_active_request')
      .on(table.requestId)
      .where(sql`${table.requestId} IS NOT NULL AND ${table.state} <> 'committed'`),
    uniqueIndex('operations_upload')
      .on(table.uploadId)
      .where(sql`${table.uploadId} IS NOT NULL`),
  ],
)

export const uploadSessions = sqliteTable(
  'upload_sessions',
  {
    id: text().primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    bytes: integer().notNull().default(0),
    expiresAt: integer('expires_at').notNull(),
    completedRequestId: text('completed_request_id').references(() => requests.id, { onDelete: 'cascade' }),
  },
  (table) => [index('upload_sessions_owner').on(table.ownerId, table.expiresAt)],
)

export const settings = sqliteTable('settings', {
  key: text().primaryKey(),
  valueJson: text('value_json').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const invites = sqliteTable(
  'invites',
  {
    id: text().primaryKey(),
    tokenHash: text('token_hash').notNull().unique(),
    role: text({ enum: ['admin', 'requester'] }).notNull(),
    label: text(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    usedAt: integer('used_at'),
    usedBy: text('used_by'),
  },
  (table) => [check('invites_role_check', sql`${table.role} IN ('admin', 'requester')`)],
)

export const plateModelAnalysis = sqliteTable(
  'plate_model_analysis',
  {
    requestId: text('request_id')
      .primaryKey()
      .references(() => requests.id, { onDelete: 'cascade' }),
    widthMm: real('width_mm').notNull(),
    depthMm: real('depth_mm').notNull(),
    heightMm: real('height_mm').notNull(),
    analyzedAt: integer('analyzed_at').notNull(),
    orientationQuaternion: text('orientation_quaternion'),
    orientationIslandCount: integer('orientation_island_count'),
    orientationRisk: real('orientation_risk'),
    orientationCandidates: text('orientation_candidates'),
    contentHash: text('content_hash'),
    analysisVersion: integer('analysis_version').notNull().default(1),
    estimatedVolumeMm3: real('estimated_volume_mm3'),
  },
  (table) => [index('plate_model_analysis_content_hash').on(table.contentHash)],
)

export const orientationAnalysisJobs = sqliteTable(
  'orientation_analysis_jobs',
  {
    requestId: text('request_id')
      .primaryKey()
      .references(() => requests.id, { onDelete: 'cascade' }),
    status: text({ enum: ['pending', 'running', 'ready', 'failed'] }).notNull(),
    analysisVersion: integer('analysis_version').notNull(),
    error: text(),
    queuedAt: integer('queued_at').notNull(),
    startedAt: integer('started_at'),
    finishedAt: integer('finished_at'),
  },
  (table) => [
    check('orientation_analysis_jobs_status_check', sql`${table.status} IN ('pending', 'running', 'ready', 'failed')`),
    index('orientation_analysis_jobs_status').on(table.status, table.queuedAt),
  ],
)

export const assetGenerationJobs = sqliteTable(
  'asset_generation_jobs',
  {
    requestId: text('request_id')
      .notNull()
      .references(() => requests.id, { onDelete: 'cascade' }),
    stage: text({ enum: ['thumbnail', 'preview'] }).notNull(),
    status: text({ enum: ['pending', 'running', 'ready', 'skipped', 'failed'] }).notNull(),
    error: text(),
    queuedAt: integer('queued_at').notNull(),
    startedAt: integer('started_at'),
    finishedAt: integer('finished_at'),
  },
  (table) => [
    check('asset_generation_jobs_stage_check', sql`${table.stage} IN ('thumbnail', 'preview')`),
    check('asset_generation_jobs_status_check', sql`${table.status} IN ('pending', 'running', 'ready', 'skipped', 'failed')`),
    primaryKey({ columns: [table.requestId, table.stage] }),
    index('asset_generation_jobs_status').on(table.status, table.queuedAt),
  ],
)

export const schema = {
  account,
  assetGenerationJobs,
  invites,
  operations,
  orientationAnalysisJobs,
  plateModelAnalysis,
  rateLimit,
  requests,
  requestStatuses,
  session,
  settings,
  twoFactor,
  uploadSessions,
  user,
  verification,
}
