import { bigint, customType, index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'

const isoDate = customType<{ data: Date; driverData: string }>({
  dataType: () => 'text',
  fromDriver: (value) => new Date(value),
  toDriver: (value) => value.toISOString(),
})

export const user = pgTable('user', {
  id: text().primaryKey().notNull(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: integer().notNull(),
  image: text(),
  createdAt: isoDate().notNull(),
  updatedAt: isoDate().notNull(),
  role: text({ enum: ['super_admin', 'requester'] }),
  banned: integer(),
  banReason: text(),
  banExpires: isoDate(),
  color: text(),
  twoFactorEnabled: integer().notNull().default(0),
})

export const session = pgTable(
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

export const organization = pgTable(
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

export const member = pgTable(
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

export const invitation = pgTable(
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

export const account = pgTable(
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

export const verification = pgTable(
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

export const rateLimit = pgTable(
  'rateLimit',
  {
    id: text().primaryKey().notNull(),
    key: text().notNull().unique(),
    count: integer().notNull(),
    lastRequest: bigint({ mode: 'number' }).notNull(),
  },
  (table) => [index('rateLimit_key_idx').on(table.key)],
)

export const twoFactor = pgTable(
  'twoFactor',
  {
    id: text().primaryKey().notNull(),
    secret: text().notNull(),
    backupCodes: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    verified: integer().notNull().default(1),
    failedVerificationCount: integer().notNull().default(0),
    lockedUntil: isoDate(),
  },
  (table) => [index('twoFactor_secret_idx').on(table.secret), index('twoFactor_userId_idx').on(table.userId)],
)
