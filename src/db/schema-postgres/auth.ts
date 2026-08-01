import { sql } from 'drizzle-orm'
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
  stripeCustomerId: text('stripe_customer_id'),
})

export const userOnboarding = pgTable('user_onboarding', {
  userId: text('user_id')
    .primaryKey()
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  completedTasks: text('completed_tasks').notNull().default('[]'),
  skippedTasks: text('skipped_tasks').notNull().default('[]'),
  celebratedTasks: text('celebrated_tasks').notNull().default('[]'),
  workspaceTasks: text('workspace_tasks').notNull().default('{}'),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
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

export const subscription = pgTable(
  'subscription',
  {
    id: text().primaryKey().notNull(),
    plan: text().notNull(),
    referenceId: text('reference_id').notNull(),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    status: text().notNull().default('incomplete'),
    periodStart: isoDate('period_start'),
    periodEnd: isoDate('period_end'),
    trialStart: isoDate('trial_start'),
    trialEnd: isoDate('trial_end'),
    cancelAtPeriodEnd: integer('cancel_at_period_end').notNull().default(0),
    cancelAt: isoDate('cancel_at'),
    canceledAt: isoDate('canceled_at'),
    endedAt: isoDate('ended_at'),
    seats: integer(),
    billingInterval: text('billing_interval'),
    stripeScheduleId: text('stripe_schedule_id'),
    createdAt: isoDate('created_at')
      .notNull()
      .default(sql`(now()::text)`),
    updatedAt: isoDate('updated_at')
      .notNull()
      .default(sql`(now()::text)`),
  },
  (table) => [
    index('subscription_referenceId_idx').on(table.referenceId),
    index('subscription_stripeCustomerId_idx').on(table.stripeCustomerId),
  ],
)
