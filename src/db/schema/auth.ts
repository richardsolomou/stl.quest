import { customType, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

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
    activeOrganizationId: text(),
  },
  (table) => [index('session_userId_idx').on(table.userId)],
)

export const organization = sqliteTable(
  'organization',
  {
    id: text().primaryKey().notNull(),
    name: text().notNull(),
    slug: text().notNull().unique(),
    logo: text(),
    createdAt: isoDate().notNull(),
    metadata: text(),
    personalOwnerId: text('personal_owner_id').references(() => user.id, { onDelete: 'set null' }),
  },
  (table) => [uniqueIndex('organization_personal_owner_unique').on(table.personalOwnerId)],
)

export const member = sqliteTable(
  'member',
  {
    id: text().primaryKey().notNull(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text({ enum: ['owner', 'admin', 'member'] })
      .notNull()
      .default('member'),
    createdAt: isoDate().notNull(),
  },
  (table) => [
    uniqueIndex('member_organization_user_unique').on(table.organizationId, table.userId),
    index('member_organization_idx').on(table.organizationId),
    index('member_user_idx').on(table.userId),
  ],
)

export const invitation = sqliteTable(
  'invitation',
  {
    id: text().primaryKey().notNull(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    email: text().notNull(),
    role: text({ enum: ['owner', 'admin', 'member'] }),
    status: text({ enum: ['pending', 'accepted', 'rejected', 'canceled'] })
      .notNull()
      .default('pending'),
    expiresAt: isoDate().notNull(),
    createdAt: isoDate().notNull(),
    inviterId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [index('invitation_organization_idx').on(table.organizationId), index('invitation_email_idx').on(table.email)],
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
