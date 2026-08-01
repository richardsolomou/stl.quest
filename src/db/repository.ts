import { and, count, desc, eq, gt, gte, inArray, isNotNull, isNull, lte, max, ne, or, sql } from 'drizzle-orm'
import { isDeepStrictEqual } from 'node:util'
import type {
  NewPrintRequest,
  OperationPayload,
  PrintGroup,
  PrintGroupColor,
  PrintGroupItem,
  PrinterProfile,
  Repository,
  RequestFilters,
  RequestQuery,
  RepeatOperation,
  Role,
  UploadOperation,
} from '../core/types'
import { initialStatus, workflow } from '../core/workflow'
import { normalizeEmail } from '../core/identity'
import { workspaceSlug } from '../core/workspaces'
import { highestStoragePlan, type StoragePlan } from '../core/plans'
import { ACTIVE_SUBSCRIPTION_STATUSES } from '../core/subscription'
import { automaticallyAssignedPrinter, normalizePrinterProfile, PRINTERS_SETTING, storedPrinterProfiles } from '../core/printers'
import { supportsDatabaseBackup, type DatabaseBackend } from './backend'
import { SQLiteBackend } from './backends/sqlite'
import { configuredDatabaseBackend } from './config'
import type { STLQuestDatabase } from './connection'
import {
  assetGenerationJobs,
  assetMigrations,
  deploymentSettings,
  invites,
  member,
  operations,
  organization,
  printGroupItems,
  printGroups,
  requests,
  requestStatuses,
  session as authSession,
  settings,
  uploadSessions,
  managedStorageAccounts,
  managedStorageUsage,
  managedStorageEntitlements,
  subscription,
  user,
  userOnboarding,
  workspaceOnboarding,
} from './schema'
import { normalizeOnboardingTasks, onboardingTaskScope, type OnboardingProgress } from '../core/onboarding'
import { mapAssetGenerationJob, mapInvite, mapRequest, mapUserIdentity, parseOperationPayload, type RequestRow } from './repository/mappers'
import { requestConditions, requestOrderBy, requestSelection, type RequestFilterOptions } from './repository/requestQuery'

type DatabaseTransaction = Parameters<Parameters<STLQuestDatabase['transaction']>[0]>[0]
type DatabaseExecutor = STLQuestDatabase | DatabaseTransaction
const MANAGED_STORAGE_DELETION_QUEUE = 'managed-storage-deletion-queue'

function parseOnboardingTasks(value: string) {
  try {
    const parsed: unknown = JSON.parse(value)
    return normalizeOnboardingTasks(Array.isArray(parsed) ? parsed.filter((task): task is string => typeof task === 'string') : [])
  } catch {
    return []
  }
}

function onboardingTasksForScope(tasks: string[], scope: 'user' | 'workspace') {
  return normalizeOnboardingTasks(tasks).filter((task) => onboardingTaskScope(task) === scope)
}

export class DrizzleRepository implements Repository {
  readonly database: STLQuestDatabase
  readonly workspaceId?: string
  private readonly backend: DatabaseBackend<STLQuestDatabase>
  private resolvedWorkspaceId?: string

  private constructor(
    database: STLQuestDatabase | DatabaseBackend<STLQuestDatabase>,
    options: { workspaceId?: string; initialize?: boolean; ownsDatabase?: boolean } = {},
  ) {
    this.backend = 'database' in database ? database : new SQLiteBackend(database, options.ownsDatabase)
    this.database = this.backend.database
    this.workspaceId = options.workspaceId
    this.resolvedWorkspaceId = options.workspaceId
  }

  static async create(
    database: STLQuestDatabase | DatabaseBackend<STLQuestDatabase>,
    options: { workspaceId?: string; initialize?: boolean; ownsDatabase?: boolean } = {},
  ) {
    const repository = new DrizzleRepository(database, options)
    if (options.initialize !== false) {
      await repository.backend.initialize()
      await repository.backfillPrinterPresetIds()
      await repository.backfillAutomaticPrinterAssignments()
    }
    return repository
  }

  static async open(file?: string) {
    return DrizzleRepository.create(file ? SQLiteBackend.open(file) : configuredDatabaseBackend())
  }

  async scoped(workspaceId: string) {
    return new DrizzleRepository(this.backend.shared(), { workspaceId, initialize: false })
  }

  private async workspace() {
    if (this.resolvedWorkspaceId) return this.resolvedWorkspaceId
    const existing = (await this.database.select({ id: organization.id }).from(organization).orderBy(organization.createdAt).limit(1).get())
      ?.id
    if (existing) return (this.resolvedWorkspaceId = existing)
    if (process.env.NODE_ENV !== 'test') throw new Error('workspace-scoped repository required')
    const id = 'test-workspace'
    await this.database
      .insert(organization)
      .values({ id, name: 'Test workspace', slug: id, createdAt: new Date() })
      .onConflictDoNothing()
      .run()
    return (this.resolvedWorkspaceId = id)
  }

  async close() {
    await this.backend.close()
  }

  async databaseInfo() {
    return this.backend.info()
  }

  maintain() {
    return this.backend.maintain()
  }

  async backup(destination: string) {
    if (!supportsDatabaseBackup(this.backend)) throw new Error('database backups are not available for this backend')
    return this.backend.backup(destination)
  }

  async listRequests() {
    const workspaceId = await this.workspace()
    const rows = await this.database
      .select(requestSelection)
      .from(requests)
      .innerJoin(user, eq(user.id, requests.ownerUserId))
      .where(eq(requests.workspaceId, workspaceId))
      .orderBy(desc(requests.createdAt))
      .all()
    return await this.hydrateRows(rows)
  }

  async hasRequests() {
    const workspaceId = await this.workspace()
    return (
      (await this.database.select({ id: requests.id }).from(requests).where(eq(requests.workspaceId, workspaceId)).limit(1).get()) !==
      undefined
    )
  }

  async queryRequests(query: RequestQuery = {}) {
    const filters = query.filters ?? {}
    const rows = await this.database
      .select(requestSelection)
      .from(requests)
      .innerJoin(user, eq(user.id, requests.ownerUserId))
      .where(await this.requestConditions(filters, query))
      .orderBy(...requestOrderBy(filters.sort))
      .all()

    const requesters = await this.database
      .select({ value: user.id, label: user.name, count: count() })
      .from(requests)
      .innerJoin(user, eq(user.id, requests.ownerUserId))
      .where(await this.requestConditions(filters, query, { omitRequester: true }))
      .groupBy(user.id, user.name)
      .orderBy(sql`lower(${user.name})`, user.id)
      .all()

    const available = await this.database
      .select({ count: count() })
      .from(requests)
      .innerJoin(user, eq(user.id, requests.ownerUserId))
      .where(await this.requestConditions({}, query, { includeOwner: false }))
      .get()

    return {
      requests: await this.hydrateRows(rows),
      facets: {
        requesters,
        total: rows.length,
        available: available?.count ?? 0,
      },
    }
  }

  async getRequest(id: string) {
    return await this.getRequestFrom(this.database, id)
  }

  async listGroups(): Promise<PrintGroup[]> {
    const workspaceId = await this.workspace()
    const groups = await this.database
      .select()
      .from(printGroups)
      .where(eq(printGroups.workspaceId, workspaceId))
      .orderBy(printGroups.createdAt)
      .all()
    const items = await this.database.select().from(printGroupItems).where(eq(printGroupItems.workspaceId, workspaceId)).all()
    return groups.map((group) => ({
      id: group.id,
      name: group.name,
      color: group.color,
      status: group.statusId,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
      items: items
        .filter((item) => item.groupId === group.id)
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map((item) => ({ requestId: item.requestId, count: item.quantity, order: item.sortOrder })),
    }))
  }

  async getGroup(id: string) {
    return (await this.listGroups()).find((group) => group.id === id)
  }

  private async groupedQuantity(database: DatabaseExecutor, requestId: string, status: string) {
    return (
      (
        await database
          .select({ quantity: sql<number>`coalesce(sum(${printGroupItems.quantity}), 0)` })
          .from(printGroupItems)
          .innerJoin(
            printGroups,
            and(eq(printGroups.workspaceId, printGroupItems.workspaceId), eq(printGroups.id, printGroupItems.groupId)),
          )
          .where(
            and(
              eq(printGroupItems.workspaceId, await this.workspace()),
              eq(printGroupItems.requestId, requestId),
              eq(printGroups.statusId, status),
            ),
          )
          .get()
      )?.quantity ?? 0
    )
  }

  private async requireUngroupedQuantity(
    database: DatabaseExecutor,
    requestId: string,
    status: string,
    quantity: number,
    message = 'invalid group item move',
  ) {
    const available = (
      await database
        .select({ quantity: requestStatuses.quantity })
        .from(requestStatuses)
        .where(
          and(
            eq(requestStatuses.workspaceId, await this.workspace()),
            eq(requestStatuses.requestId, requestId),
            eq(requestStatuses.statusId, status),
          ),
        )
        .get()
    )?.quantity
    if ((available ?? 0) - (await this.groupedQuantity(database, requestId, status)) < quantity) {
      throw new Response(message, { status: 409 })
    }
  }

  async createGroup(name: string, status: string, color: PrintGroupColor, items: Omit<PrintGroupItem, 'order'>[]) {
    const id = crypto.randomUUID()
    const workspaceId = await this.workspace()
    const now = Date.now()
    await this.database.transaction(async (tx) => {
      for (const item of items) {
        await this.requireUngroupedQuantity(tx, item.requestId, status, item.count, 'invalid group')
      }
      await tx.insert(printGroups).values({ id, workspaceId, name, color, statusId: status, createdAt: now, updatedAt: now }).run()
      if (items.length > 0) {
        await tx
          .insert(printGroupItems)
          .values(
            items.map((item, order) => ({ workspaceId, groupId: id, requestId: item.requestId, quantity: item.count, sortOrder: order })),
          )
          .run()
      }
    })
    return id
  }

  async renameGroup(id: string, name: string) {
    const changed = (
      await this.database
        .update(printGroups)
        .set({ name, updatedAt: Date.now() })
        .where(and(eq(printGroups.workspaceId, await this.workspace()), eq(printGroups.id, id)))
        .run()
    ).changes
    if (changed !== 1) throw new Response('group not found', { status: 404 })
  }

  async deleteGroup(id: string) {
    const changed = (
      await this.database
        .delete(printGroups)
        .where(and(eq(printGroups.workspaceId, await this.workspace()), eq(printGroups.id, id)))
        .run()
    ).changes
    if (changed !== 1) throw new Response('group not found', { status: 404 })
  }

  async reorderGroupItem(groupId: string, requestId: string, targetRequestId: string, edge: 'before' | 'after') {
    const workspaceId = await this.workspace()
    await this.database.transaction(async (tx) => {
      const items = await tx
        .select({ requestId: printGroupItems.requestId })
        .from(printGroupItems)
        .where(and(eq(printGroupItems.workspaceId, workspaceId), eq(printGroupItems.groupId, groupId)))
        .orderBy(printGroupItems.sortOrder)
        .all()
      const sourceIndex = items.findIndex((item) => item.requestId === requestId)
      if (sourceIndex < 0 || !items.some((item) => item.requestId === targetRequestId)) {
        throw new Response('invalid group item reorder', { status: 409 })
      }
      const [source] = items.splice(sourceIndex, 1)
      const targetIndex = items.findIndex((item) => item.requestId === targetRequestId)
      items.splice(targetIndex + (edge === 'after' ? 1 : 0), 0, source)
      for (const [sortOrder, item] of items.entries()) {
        await tx
          .update(printGroupItems)
          .set({ sortOrder })
          .where(
            and(
              eq(printGroupItems.workspaceId, workspaceId),
              eq(printGroupItems.groupId, groupId),
              eq(printGroupItems.requestId, item.requestId),
            ),
          )
          .run()
      }
    })
  }

  async moveGroupItem(requestId: string, quantity: number, status: string, fromGroupId?: string, toGroupId?: string) {
    const workspaceId = await this.workspace()
    await this.database.transaction(async (tx) => {
      const groupIds = [fromGroupId, toGroupId].filter((id): id is string => id !== undefined)
      const groups =
        groupIds.length === 0
          ? []
          : await tx
              .select({ id: printGroups.id, status: printGroups.statusId })
              .from(printGroups)
              .where(and(eq(printGroups.workspaceId, workspaceId), inArray(printGroups.id, groupIds)))
              .all()
      if (groups.length !== groupIds.length || groups.some((group) => group.status !== status)) {
        throw new Response('invalid group item move', { status: 409 })
      }

      if (fromGroupId) {
        const source = await tx
          .select({ quantity: printGroupItems.quantity })
          .from(printGroupItems)
          .where(
            and(
              eq(printGroupItems.workspaceId, workspaceId),
              eq(printGroupItems.groupId, fromGroupId),
              eq(printGroupItems.requestId, requestId),
            ),
          )
          .get()
        if (!source || source.quantity < quantity) throw new Response('invalid group item move', { status: 409 })
        if (source.quantity === quantity) {
          await tx
            .delete(printGroupItems)
            .where(
              and(
                eq(printGroupItems.workspaceId, workspaceId),
                eq(printGroupItems.groupId, fromGroupId),
                eq(printGroupItems.requestId, requestId),
              ),
            )
            .run()
        } else {
          await tx
            .update(printGroupItems)
            .set({ quantity: source.quantity - quantity })
            .where(
              and(
                eq(printGroupItems.workspaceId, workspaceId),
                eq(printGroupItems.groupId, fromGroupId),
                eq(printGroupItems.requestId, requestId),
              ),
            )
            .run()
        }
      }

      if (toGroupId) {
        await this.requireUngroupedQuantity(tx, requestId, status, quantity)
        const target = await tx
          .select({ quantity: printGroupItems.quantity })
          .from(printGroupItems)
          .where(
            and(
              eq(printGroupItems.workspaceId, workspaceId),
              eq(printGroupItems.groupId, toGroupId),
              eq(printGroupItems.requestId, requestId),
            ),
          )
          .get()
        if (target) {
          await tx
            .update(printGroupItems)
            .set({ quantity: target.quantity + quantity })
            .where(
              and(
                eq(printGroupItems.workspaceId, workspaceId),
                eq(printGroupItems.groupId, toGroupId),
                eq(printGroupItems.requestId, requestId),
              ),
            )
            .run()
        } else {
          const sortOrder =
            (
              await tx
                .select({ value: sql<number>`coalesce(max(${printGroupItems.sortOrder}), -1) + 1` })
                .from(printGroupItems)
                .where(and(eq(printGroupItems.workspaceId, workspaceId), eq(printGroupItems.groupId, toGroupId)))
                .get()
            )?.value ?? 0
          await tx.insert(printGroupItems).values({ workspaceId, groupId: toGroupId, requestId, quantity, sortOrder }).run()
        }
      }
    })
  }

  async moveGroupItemAcrossStatus(
    requestId: string,
    quantity: number,
    from: string,
    to: string,
    fromGroupId: string | undefined,
    toGroupId: string | undefined,
    filePath: string,
    movedAt: number,
  ) {
    const workspaceId = await this.workspace()
    await this.database.transaction(async (tx) => {
      if (!fromGroupId) await this.requireUngroupedQuantity(tx, requestId, from, quantity)
      if (fromGroupId) {
        const source = await tx
          .select({ status: printGroups.statusId, quantity: printGroupItems.quantity })
          .from(printGroupItems)
          .innerJoin(
            printGroups,
            and(eq(printGroups.workspaceId, printGroupItems.workspaceId), eq(printGroups.id, printGroupItems.groupId)),
          )
          .where(
            and(
              eq(printGroupItems.workspaceId, workspaceId),
              eq(printGroupItems.groupId, fromGroupId),
              eq(printGroupItems.requestId, requestId),
            ),
          )
          .get()
        if (!source || source.status !== from || source.quantity < quantity) {
          throw new Response('invalid group item move', { status: 409 })
        }
        if (source.quantity === quantity) {
          await tx
            .delete(printGroupItems)
            .where(
              and(
                eq(printGroupItems.workspaceId, workspaceId),
                eq(printGroupItems.groupId, fromGroupId),
                eq(printGroupItems.requestId, requestId),
              ),
            )
            .run()
        } else {
          await tx
            .update(printGroupItems)
            .set({ quantity: source.quantity - quantity })
            .where(
              and(
                eq(printGroupItems.workspaceId, workspaceId),
                eq(printGroupItems.groupId, fromGroupId),
                eq(printGroupItems.requestId, requestId),
              ),
            )
            .run()
        }
      }
      await this.moveCopiesWith(tx, { id: requestId, from, to, count: quantity, filePath, movedAt })
      if (toGroupId) {
        const targetGroup = await tx
          .select({ status: printGroups.statusId })
          .from(printGroups)
          .where(and(eq(printGroups.workspaceId, workspaceId), eq(printGroups.id, toGroupId)))
          .get()
        if (!targetGroup || targetGroup.status !== to) throw new Response('invalid group item move', { status: 409 })
        await this.requireUngroupedQuantity(tx, requestId, to, quantity)
        const target = await tx
          .select({ quantity: printGroupItems.quantity })
          .from(printGroupItems)
          .where(
            and(
              eq(printGroupItems.workspaceId, workspaceId),
              eq(printGroupItems.groupId, toGroupId),
              eq(printGroupItems.requestId, requestId),
            ),
          )
          .get()
        if (target) {
          await tx
            .update(printGroupItems)
            .set({ quantity: target.quantity + quantity })
            .where(
              and(
                eq(printGroupItems.workspaceId, workspaceId),
                eq(printGroupItems.groupId, toGroupId),
                eq(printGroupItems.requestId, requestId),
              ),
            )
            .run()
        } else {
          const sortOrder =
            (
              await tx
                .select({ value: sql<number>`coalesce(max(${printGroupItems.sortOrder}), -1) + 1` })
                .from(printGroupItems)
                .where(and(eq(printGroupItems.workspaceId, workspaceId), eq(printGroupItems.groupId, toGroupId)))
                .get()
            )?.value ?? 0
          await tx.insert(printGroupItems).values({ workspaceId, groupId: toGroupId, requestId, quantity, sortOrder }).run()
        }
      }
    })
  }

  async moveGroup(
    id: string,
    to: string,
    inputs: { id: string; from: string; to: string; count: number; filePath: string; movedAt?: number }[],
  ) {
    await this.database.transaction(async (tx) => {
      const group = await tx
        .select({ id: printGroups.id, status: printGroups.statusId })
        .from(printGroups)
        .where(and(eq(printGroups.workspaceId, await this.workspace()), eq(printGroups.id, id)))
        .get()
      if (!group) throw new Response('group not found', { status: 404 })
      if (inputs.some((input) => input.from !== group.status || input.to !== to)) {
        throw new Response('invalid group move', { status: 409 })
      }
      for (const input of inputs) await this.moveCopiesWith(tx, input)
      await tx
        .update(printGroups)
        .set({ statusId: to, updatedAt: Date.now() })
        .where(and(eq(printGroups.workspaceId, await this.workspace()), eq(printGroups.id, id)))
        .run()
    })
  }

  private async getRequestFrom(database: DatabaseExecutor, id: string) {
    const workspaceId = await this.workspace()
    const row = await database
      .select(requestSelection)
      .from(requests)
      .innerJoin(user, eq(user.id, requests.ownerUserId))
      .where(and(eq(requests.workspaceId, workspaceId), eq(requests.id, id)))
      .get()
    return row ? await this.hydrate(database, row) : undefined
  }

  async createRequest(request: NewPrintRequest) {
    const id = crypto.randomUUID()
    await this.workspace()
    await this.database.transaction(async (tx) => await this.insertRequest(tx, id, request))
    return id
  }

  async createUploadSession(uploadId: string, ownerId: string, expiresAt: number, maxIncomplete: number) {
    const workspaceId = await this.workspace()
    return await this.database.transaction(async (tx) => {
      const existing = await tx
        .select({ ownerId: uploadSessions.ownerId, completedRequestId: uploadSessions.completedRequestId })
        .from(uploadSessions)
        .where(and(eq(uploadSessions.workspaceId, workspaceId), eq(uploadSessions.id, uploadId)))
        .get()
      if (existing) {
        if (existing.ownerId !== ownerId) throw new Response('upload id belongs to another user', { status: 409 })
        await tx
          .update(uploadSessions)
          .set({ expiresAt })
          .where(
            and(eq(uploadSessions.workspaceId, workspaceId), eq(uploadSessions.id, uploadId), isNull(uploadSessions.completedRequestId)),
          )
          .run()
        return { fresh: false, completedRequestId: existing.completedRequestId ?? undefined }
      }
      const active = (
        await tx
          .select({ count: count() })
          .from(uploadSessions)
          .where(
            and(
              eq(uploadSessions.ownerId, ownerId),
              eq(uploadSessions.workspaceId, workspaceId),
              isNull(uploadSessions.completedRequestId),
              gt(uploadSessions.bytes, 0),
              gt(uploadSessions.expiresAt, Date.now()),
            ),
          )
          .get()
      )?.count
      if ((active ?? 0) >= maxIncomplete) throw new Response('too many incomplete uploads', { status: 429 })
      await tx.insert(uploadSessions).values({ id: uploadId, workspaceId, ownerId, expiresAt }).run()
      return { fresh: true }
    })
  }

  async reserveUpload(
    uploadId: string,
    ownerId: string,
    bytes: number,
    expiresAt: number,
    limits: { count: number; bytes: number; managedBytes?: number },
  ) {
    const workspaceId = await this.workspace()
    return await this.database.transaction(async (tx) => {
      const session = await tx
        .select()
        .from(uploadSessions)
        .where(and(eq(uploadSessions.workspaceId, workspaceId), eq(uploadSessions.id, uploadId)))
        .get()
      if (!session || session.ownerId !== ownerId || session.completedRequestId) return false
      const managedOwnerId = limits.managedBytes === undefined ? undefined : await this.managedStorageOwner(tx)
      if (limits.managedBytes !== undefined && !managedOwnerId) throw new Error('managed storage entitlement is missing')
      if (managedOwnerId) await this.lockManagedStorageAccount(tx, managedOwnerId)
      const usage = (await tx
        .select({ count: count(), bytes: sql<number>`coalesce(sum(${uploadSessions.bytes}),0)` })
        .from(uploadSessions)
        .where(
          and(
            eq(uploadSessions.ownerId, ownerId),
            eq(uploadSessions.workspaceId, workspaceId),
            isNull(uploadSessions.completedRequestId),
            gt(uploadSessions.bytes, 0),
            gt(uploadSessions.expiresAt, Date.now()),
          ),
        )
        .get()) ?? { count: 0, bytes: 0 }
      const nextCount = usage.count + (session.bytes > 0 ? 0 : 1)
      const managedUploads = managedOwnerId ? await this.managedUploadBytes(tx, managedOwnerId, Date.now()) : 0
      const managedUsage = managedOwnerId
        ? ((await tx
            .select({ bytes: managedStorageAccounts.persistedBytes, reserved: managedStorageAccounts.assetReservedBytes })
            .from(managedStorageAccounts)
            .where(eq(managedStorageAccounts.ownerId, managedOwnerId))
            .get()) ?? { bytes: 0, reserved: 0 })
        : { bytes: 0, reserved: 0 }
      if (
        nextCount > limits.count ||
        usage.bytes - session.bytes + bytes > limits.bytes ||
        (limits.managedBytes !== undefined &&
          managedUsage.bytes + managedUsage.reserved + managedUploads - session.bytes + bytes > limits.managedBytes)
      ) {
        if (session.bytes === 0)
          await tx
            .delete(uploadSessions)
            .where(and(eq(uploadSessions.workspaceId, workspaceId), eq(uploadSessions.id, uploadId)))
            .run()
        return false
      }
      await tx
        .update(uploadSessions)
        .set({ bytes, expiresAt })
        .where(and(eq(uploadSessions.workspaceId, workspaceId), eq(uploadSessions.id, uploadId)))
        .run()
      return true
    })
  }

  async expireUploads(now: number) {
    const workspaceId = await this.workspace()
    return await this.database.transaction(async (tx) => {
      const expired = and(
        eq(uploadSessions.workspaceId, workspaceId),
        isNull(uploadSessions.completedRequestId),
        lte(uploadSessions.expiresAt, now),
        eq(uploadSessions.finalizingBytes, 0),
      )
      const ids = (await tx.select({ id: uploadSessions.id }).from(uploadSessions).where(expired).all()).map(({ id }) => id)
      await tx.delete(uploadSessions).where(expired).run()
      return ids
    })
  }

  async activeUploadIds(now: number) {
    const workspaceId = await this.workspace()
    return new Set(
      (
        await this.database
          .select({ id: uploadSessions.id })
          .from(uploadSessions)
          .where(
            and(
              eq(uploadSessions.workspaceId, workspaceId),
              isNull(uploadSessions.completedRequestId),
              or(and(gt(uploadSessions.bytes, 0), gt(uploadSessions.expiresAt, now)), gt(uploadSessions.finalizingBytes, 0)),
            ),
          )
          .all()
      ).map(({ id }) => id),
    )
  }

  async hasActiveUploads(now: number) {
    const workspaceId = await this.workspace()
    return (
      (await this.database
        .select({ id: uploadSessions.id })
        .from(uploadSessions)
        .where(
          and(
            eq(uploadSessions.workspaceId, workspaceId),
            isNull(uploadSessions.completedRequestId),
            or(and(gt(uploadSessions.bytes, 0), gt(uploadSessions.expiresAt, now)), gt(uploadSessions.finalizingBytes, 0)),
          ),
        )
        .limit(1)
        .get()) !== undefined
    )
  }

  async incompleteUploadStats(now: number) {
    const workspaceId = await this.workspace()
    return (
      (await this.database
        .select({ count: count(), bytes: sql<number>`coalesce(sum(${uploadSessions.bytes}),0)` })
        .from(uploadSessions)
        .where(
          and(
            eq(uploadSessions.workspaceId, workspaceId),
            isNull(uploadSessions.completedRequestId),
            gt(uploadSessions.bytes, 0),
            gt(uploadSessions.expiresAt, now),
          ),
        )
        .get()) ?? { count: 0, bytes: 0 }
    )
  }

  async reconcileManagedStorageUsage(persistedBytes: number) {
    const workspaceId = await this.workspace()
    await this.database.transaction(async (tx) => {
      const ownerId = await this.managedStorageOwner(tx)
      if (!ownerId) throw new Error('managed storage entitlement is missing')
      await this.lockManagedStorageAccount(tx, ownerId)
      const previous = (await tx
        .select({ persistedBytes: managedStorageUsage.persistedBytes, assetReservedBytes: managedStorageUsage.assetReservedBytes })
        .from(managedStorageUsage)
        .where(eq(managedStorageUsage.workspaceId, workspaceId))
        .get()) ?? { persistedBytes: 0, assetReservedBytes: 0 }
      const finalizingBytes =
        (
          await tx
            .select({ bytes: sql<number>`coalesce(sum(${uploadSessions.finalizingBytes}),0)` })
            .from(uploadSessions)
            .where(and(eq(uploadSessions.workspaceId, workspaceId), gt(uploadSessions.finalizingBytes, 0)))
            .get()
        )?.bytes ?? 0
      await tx
        .insert(managedStorageUsage)
        .values({ workspaceId, persistedBytes, assetReservedBytes: finalizingBytes })
        .onConflictDoUpdate({ target: managedStorageUsage.workspaceId, set: { persistedBytes, assetReservedBytes: finalizingBytes } })
        .run()
      const persistedDelta = persistedBytes - previous.persistedBytes
      const reservedDelta = finalizingBytes - previous.assetReservedBytes
      await tx
        .update(managedStorageAccounts)
        .set({
          persistedBytes: sql`CASE WHEN ${managedStorageAccounts.persistedBytes} + ${persistedDelta} > 0 THEN ${managedStorageAccounts.persistedBytes} + ${persistedDelta} ELSE 0 END`,
          assetReservedBytes: sql`CASE WHEN ${managedStorageAccounts.assetReservedBytes} + ${reservedDelta} > 0 THEN ${managedStorageAccounts.assetReservedBytes} + ${reservedDelta} ELSE 0 END`,
        })
        .where(eq(managedStorageAccounts.ownerId, ownerId))
        .run()
    })
  }

  async claimManagedStorage(ownerId: string, workspaceLimit: number) {
    const workspaceId = await this.workspace()
    return await this.database.transaction(async (tx) => {
      await this.lockManagedStorageAccount(tx, ownerId)
      const existing = await tx
        .select({ ownerId: managedStorageEntitlements.ownerId })
        .from(managedStorageEntitlements)
        .where(eq(managedStorageEntitlements.workspaceId, workspaceId))
        .get()
      if (existing?.ownerId === ownerId) return false
      if (existing) throw new Response('managed storage belongs to another workspace owner', { status: 409 })
      const used =
        (await tx.select({ count: count() }).from(managedStorageEntitlements).where(eq(managedStorageEntitlements.ownerId, ownerId)).get())
          ?.count ?? 0
      if (used >= workspaceLimit) throw new Response(`managed storage is limited to ${workspaceLimit} owned workspaces`, { status: 409 })
      await tx.insert(managedStorageEntitlements).values({ workspaceId, ownerId }).run()
      await tx.insert(managedStorageUsage).values({ workspaceId }).onConflictDoNothing().run()
      return true
    })
  }

  async workspaceOwnerId() {
    return (
      await this.database
        .select({ userId: member.userId })
        .from(member)
        .where(and(eq(member.organizationId, await this.workspace()), eq(member.role, 'owner')))
        .get()
    )?.userId
  }

  async managedStorageEligible(ownerId: string, workspaceLimit: number) {
    const workspaceId = await this.workspace()
    const entitlement = await this.database
      .select({ ownerId: managedStorageEntitlements.ownerId })
      .from(managedStorageEntitlements)
      .where(eq(managedStorageEntitlements.workspaceId, workspaceId))
      .get()
    if (entitlement) return entitlement.ownerId === ownerId
    const used =
      (
        await this.database
          .select({ count: count() })
          .from(managedStorageEntitlements)
          .where(eq(managedStorageEntitlements.ownerId, ownerId))
          .get()
      )?.count ?? 0
    return used < workspaceLimit
  }

  async releaseManagedStorage() {
    await this.database
      .delete(managedStorageEntitlements)
      .where(eq(managedStorageEntitlements.workspaceId, await this.workspace()))
      .run()
  }

  async reserveManagedAssetBytes(bytes: number, quota: number) {
    if (bytes <= 0) return true
    const workspaceId = await this.workspace()
    return await this.database.transaction(async (tx) => {
      const ownerId = await this.managedStorageOwner(tx)
      if (!ownerId) throw new Error('managed storage entitlement is missing')
      await this.lockManagedStorageAccount(tx, ownerId)
      const uploads = await this.managedUploadBytes(tx, ownerId, Date.now())
      const updated = await tx
        .update(managedStorageAccounts)
        .set({ assetReservedBytes: sql`${managedStorageAccounts.assetReservedBytes} + ${bytes}` })
        .where(
          and(
            eq(managedStorageAccounts.ownerId, ownerId),
            sql`${managedStorageAccounts.persistedBytes} + ${managedStorageAccounts.assetReservedBytes} + ${uploads} + ${bytes} <= ${quota}`,
          ),
        )
        .returning({ ownerId: managedStorageAccounts.ownerId })
        .get()
      if (!updated) return false
      await tx
        .update(managedStorageUsage)
        .set({ assetReservedBytes: sql`${managedStorageUsage.assetReservedBytes} + ${bytes}` })
        .where(eq(managedStorageUsage.workspaceId, workspaceId))
        .run()
      return true
    })
  }

  async finishManagedAssetReservation(reservedBytes: number, persistedDelta: number) {
    const workspaceId = await this.workspace()
    await this.database.transaction(async (tx) => {
      const ownerId = await this.managedStorageOwner(tx)
      if (!ownerId) throw new Error('managed storage entitlement is missing')
      await this.lockManagedStorageAccount(tx, ownerId)
      await tx
        .update(managedStorageUsage)
        .set({
          assetReservedBytes: sql`CASE WHEN ${managedStorageUsage.assetReservedBytes} > ${reservedBytes} THEN ${managedStorageUsage.assetReservedBytes} - ${reservedBytes} ELSE 0 END`,
          persistedBytes: sql`CASE WHEN ${managedStorageUsage.persistedBytes} + ${persistedDelta} > 0 THEN ${managedStorageUsage.persistedBytes} + ${persistedDelta} ELSE 0 END`,
        })
        .where(eq(managedStorageUsage.workspaceId, workspaceId))
        .run()
      await tx
        .update(managedStorageAccounts)
        .set({
          assetReservedBytes: sql`CASE WHEN ${managedStorageAccounts.assetReservedBytes} > ${reservedBytes} THEN ${managedStorageAccounts.assetReservedBytes} - ${reservedBytes} ELSE 0 END`,
          persistedBytes: sql`CASE WHEN ${managedStorageAccounts.persistedBytes} + ${persistedDelta} > 0 THEN ${managedStorageAccounts.persistedBytes} + ${persistedDelta} ELSE 0 END`,
        })
        .where(eq(managedStorageAccounts.ownerId, ownerId))
        .run()
    })
  }

  async beginManagedUploadFinalize(uploadId: string) {
    const workspaceId = await this.workspace()
    return await this.database.transaction(async (tx) => {
      const ownerId = await this.managedStorageOwner(tx)
      if (!ownerId) throw new Error('managed storage entitlement is missing')
      await this.lockManagedStorageAccount(tx, ownerId)
      const session = await tx
        .select({ bytes: uploadSessions.bytes, finalizingBytes: uploadSessions.finalizingBytes })
        .from(uploadSessions)
        .where(and(eq(uploadSessions.workspaceId, workspaceId), eq(uploadSessions.id, uploadId)))
        .get()
      if (!session) throw new Response('upload session not found', { status: 404 })
      if (session.finalizingBytes > 0) return session.finalizingBytes
      if (session.bytes <= 0) throw new Response('upload reservation is missing', { status: 409 })
      await tx
        .update(uploadSessions)
        .set({ bytes: 0, finalizingBytes: session.bytes })
        .where(and(eq(uploadSessions.workspaceId, workspaceId), eq(uploadSessions.id, uploadId)))
        .run()
      await tx
        .update(managedStorageUsage)
        .set({ assetReservedBytes: sql`${managedStorageUsage.assetReservedBytes} + ${session.bytes}` })
        .where(eq(managedStorageUsage.workspaceId, workspaceId))
        .run()
      await tx
        .update(managedStorageAccounts)
        .set({ assetReservedBytes: sql`${managedStorageAccounts.assetReservedBytes} + ${session.bytes}` })
        .where(eq(managedStorageAccounts.ownerId, ownerId))
        .run()
      return session.bytes
    })
  }

  async finishManagedUploadFinalize(uploadId: string, persistedDelta: number) {
    const workspaceId = await this.workspace()
    await this.database.transaction(async (tx) => {
      const ownerId = await this.managedStorageOwner(tx)
      if (!ownerId) throw new Error('managed storage entitlement is missing')
      await this.lockManagedStorageAccount(tx, ownerId)
      await this.settleUploadFinalize(tx, workspaceId, ownerId, uploadId, persistedDelta)
    })
  }

  private async settleUploadFinalize(
    database: DatabaseExecutor,
    workspaceId: string,
    ownerId: string,
    uploadId: string,
    persistedDelta: number,
  ) {
    const session = await database
      .select({ finalizingBytes: uploadSessions.finalizingBytes })
      .from(uploadSessions)
      .where(and(eq(uploadSessions.workspaceId, workspaceId), eq(uploadSessions.id, uploadId)))
      .get()
    if (!session?.finalizingBytes) return
    await database
      .update(managedStorageUsage)
      .set({
        assetReservedBytes: sql`CASE WHEN ${managedStorageUsage.assetReservedBytes} > ${session.finalizingBytes} THEN ${managedStorageUsage.assetReservedBytes} - ${session.finalizingBytes} ELSE 0 END`,
        persistedBytes: sql`${managedStorageUsage.persistedBytes} + ${persistedDelta}`,
      })
      .where(eq(managedStorageUsage.workspaceId, workspaceId))
      .run()
    await database
      .update(uploadSessions)
      .set({ finalizingBytes: 0 })
      .where(and(eq(uploadSessions.workspaceId, workspaceId), eq(uploadSessions.id, uploadId)))
      .run()
    await database
      .update(managedStorageAccounts)
      .set({
        assetReservedBytes: sql`CASE WHEN ${managedStorageAccounts.assetReservedBytes} > ${session.finalizingBytes} THEN ${managedStorageAccounts.assetReservedBytes} - ${session.finalizingBytes} ELSE 0 END`,
        persistedBytes: sql`${managedStorageAccounts.persistedBytes} + ${persistedDelta}`,
      })
      .where(eq(managedStorageAccounts.ownerId, ownerId))
      .run()
  }

  async managedStorageRemaining(quota: number, owner?: string) {
    const ownerId = owner ?? (await this.managedStorageOwner(this.database))
    if (!ownerId) return quota
    const [usage, uploads] = await Promise.all([
      this.database.select().from(managedStorageAccounts).where(eq(managedStorageAccounts.ownerId, ownerId)).get(),
      this.managedUploadBytes(this.database, ownerId, Date.now()),
    ])
    return Math.max(0, quota - (usage?.persistedBytes ?? 0) - (usage?.assetReservedBytes ?? 0) - uploads)
  }

  async managedStoragePlan(ownerId?: string): Promise<StoragePlan> {
    const referenceId = ownerId ?? (await this.managedStorageOwner(this.database))
    if (!referenceId) return 'free'
    const subscriptions = await this.database
      .select({ plan: subscription.plan })
      .from(subscription)
      .where(and(eq(subscription.referenceId, referenceId), inArray(subscription.status, ACTIVE_SUBSCRIPTION_STATUSES)))
      .all()
    return highestStoragePlan(subscriptions.map(({ plan }) => plan))
  }

  // The account whose plan governs this workspace's allowance, which is not always its owner.
  async managedStorageOwnerId() {
    return await this.managedStorageOwner(this.database)
  }

  // Whether the account has any workspace on included storage, which is what decides if an
  // allowance is worth reporting at all.
  async managedStorageEntitlementCount(ownerId: string) {
    return (
      (
        await this.database
          .select({ total: count() })
          .from(managedStorageEntitlements)
          .where(eq(managedStorageEntitlements.ownerId, ownerId))
          .get()
      )?.total ?? 0
    )
  }

  // Stripe syncs these through Better Auth, so the renewal and cancellation state needs no API call.
  async managedStorageSubscription(ownerId: string) {
    return await this.database
      .select({
        plan: subscription.plan,
        status: subscription.status,
        periodEnd: subscription.periodEnd,
        trialEnd: subscription.trialEnd,
        cancelAt: subscription.cancelAt,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        billingInterval: subscription.billingInterval,
      })
      .from(subscription)
      .where(and(eq(subscription.referenceId, ownerId), inArray(subscription.status, ACTIVE_SUBSCRIPTION_STATUSES)))
      .get()
  }

  /**
   * One allowance is shared by every workspace entitled to an account, so the plan page has to show
   * where it went rather than only the workspace being viewed.
   */
  async managedStorageWorkspaceUsage(ownerId: string) {
    return await this.database
      .select({
        workspaceId: managedStorageEntitlements.workspaceId,
        name: organization.name,
        slug: organization.slug,
        usedBytes: sql<number>`COALESCE(${managedStorageUsage.persistedBytes}, 0) + COALESCE(${managedStorageUsage.assetReservedBytes}, 0)`,
      })
      .from(managedStorageEntitlements)
      .innerJoin(organization, eq(organization.id, managedStorageEntitlements.workspaceId))
      .leftJoin(managedStorageUsage, eq(managedStorageUsage.workspaceId, managedStorageEntitlements.workspaceId))
      .where(eq(managedStorageEntitlements.ownerId, ownerId))
      .all()
  }

  private async managedStorageOwner(database: DatabaseExecutor) {
    return (
      await database
        .select({ ownerId: managedStorageEntitlements.ownerId })
        .from(managedStorageEntitlements)
        .where(eq(managedStorageEntitlements.workspaceId, await this.workspace()))
        .get()
    )?.ownerId
  }

  private async lockManagedStorageAccount(database: DatabaseExecutor, ownerId: string) {
    await database.insert(managedStorageAccounts).values({ ownerId }).onConflictDoNothing().run()
    await database
      .update(managedStorageAccounts)
      .set({ persistedBytes: sql`${managedStorageAccounts.persistedBytes}` })
      .where(eq(managedStorageAccounts.ownerId, ownerId))
      .run()
  }

  private async managedUploadBytes(database: DatabaseExecutor, ownerId: string, now: number) {
    return (
      (
        await database
          .select({ bytes: sql<number>`coalesce(sum(${uploadSessions.bytes}),0)` })
          .from(uploadSessions)
          .innerJoin(managedStorageEntitlements, eq(managedStorageEntitlements.workspaceId, uploadSessions.workspaceId))
          .where(
            and(
              eq(managedStorageEntitlements.ownerId, ownerId),
              isNull(uploadSessions.completedRequestId),
              gt(uploadSessions.bytes, 0),
              gt(uploadSessions.expiresAt, now),
            ),
          )
          .get()
      )?.bytes ?? 0
    )
  }

  async uploadIdsOwnedBy(ownerId: string) {
    const workspaceId = await this.workspace()
    return (
      await this.database
        .select({ id: uploadSessions.id })
        .from(uploadSessions)
        .where(and(eq(uploadSessions.workspaceId, workspaceId), eq(uploadSessions.ownerId, ownerId)))
        .all()
    ).map(({ id }) => id)
  }

  async deleteUploadSessions(ownerId: string) {
    const workspaceId = await this.workspace()
    await this.database
      .delete(uploadSessions)
      .where(and(eq(uploadSessions.workspaceId, workspaceId), eq(uploadSessions.ownerId, ownerId)))
      .run()
  }

  async getCompletedUpload(uploadId: string, ownerId: string) {
    const workspaceId = await this.workspace()
    return (
      (
        await this.database
          .select({ id: uploadSessions.completedRequestId })
          .from(uploadSessions)
          .where(and(eq(uploadSessions.workspaceId, workspaceId), eq(uploadSessions.id, uploadId), eq(uploadSessions.ownerId, ownerId)))
          .get()
      )?.id ?? undefined
    )
  }

  async updateRequestFilePath(id: string, previousPath: string, nextPath: string) {
    return (
      (
        await this.database
          .update(requests)
          .set({ filePath: nextPath })
          .where(and(eq(requests.workspaceId, await this.workspace()), eq(requests.id, id), eq(requests.filePath, previousPath)))
          .run()
      ).changes === 1
    )
  }

  async moveCopies(
    input: { id: string; from: string; to: string; count: number; filePath: string; order?: number; movedAt?: number },
    database?: DatabaseExecutor,
  ) {
    if (database) return await this.moveCopiesWith(database, input)
    await this.database.transaction(async (tx) => await this.moveCopiesWith(tx, input))
  }

  async moveCopiesBatch(
    inputs: { id: string; from: string; to: string; count: number; filePath: string; order?: number; movedAt?: number }[],
  ) {
    await this.database.transaction(async (tx) => {
      const active = await tx
        .select({ requestId: operations.requestId })
        .from(operations)
        .where(
          and(
            eq(operations.workspaceId, await this.workspace()),
            inArray(
              operations.requestId,
              inputs.map(({ id }) => id),
            ),
            ne(operations.state, 'committed'),
          ),
        )
        .limit(1)
        .get()
      if (active) throw new Response('another operation is already running for this request', { status: 409 })
      for (const input of inputs) await this.moveCopiesWith(tx, input)
    })
  }

  async reorderRequest(id: string, order: number) {
    const workspaceId = await this.workspace()
    await this.database
      .update(requestStatuses)
      .set({ sortOrder: order })
      .where(and(eq(requestStatuses.workspaceId, workspaceId), eq(requestStatuses.requestId, id)))
      .run()
  }

  async updateRequest(
    id: string,
    fields: {
      name?: string
      quantity?: number
      notes?: string
      sourceUrl?: string
      requestedPrintType?: import('../core/types').PrintType | null
      printerId?: string | null
      automaticPrinterAssignment?: boolean
    },
  ) {
    await this.database.transaction(async (tx) => {
      const active = await tx
        .select({ id: operations.id })
        .from(operations)
        .where(and(eq(operations.workspaceId, await this.workspace()), eq(operations.requestId, id), ne(operations.state, 'committed')))
        .limit(1)
        .get()
      if (active) throw new Response('another operation is already running for this request', { status: 409 })
      const request = await this.getRequestFrom(tx, id)
      if (!request) throw new Error('not found')
      if (fields.quantity !== undefined) {
        const started = workflow.statuses.slice(1).reduce((sum, status) => sum + (request.counts[status.id] ?? 0), 0)
        if (fields.quantity < Math.max(started, 1)) throw new Response('cannot reduce below started copies', { status: 409 })
        if (fields.quantity - started < (await this.groupedQuantity(tx, id, initialStatus().id))) {
          throw new Response('cannot reduce below grouped copies', { status: 409 })
        }
        await tx
          .update(requestStatuses)
          .set({ quantity: fields.quantity - started })
          .where(
            and(
              eq(requestStatuses.workspaceId, await this.workspace()),
              eq(requestStatuses.requestId, id),
              eq(requestStatuses.statusId, initialStatus().id),
            ),
          )
          .run()
      }
      await tx
        .update(requests)
        .set({
          name: fields.name ?? request.name,
          quantity: fields.quantity ?? request.quantity,
          notes: fields.notes ?? request.notes ?? null,
          sourceUrl: fields.sourceUrl ?? request.sourceUrl ?? null,
          printType: fields.requestedPrintType === undefined ? (request.requestedPrintType ?? null) : fields.requestedPrintType,
          printerId: fields.printerId === undefined ? (request.printerId ?? null) : fields.printerId,
          automaticPrinterAssignment: fields.automaticPrinterAssignment ?? request.automaticPrinterAssignment ?? false,
          updatedAt: Date.now(),
        })
        .where(and(eq(requests.workspaceId, await this.workspace()), eq(requests.id, id)))
        .run()
    })
  }

  async deleteRequest(id: string, database: DatabaseExecutor = this.database) {
    await database
      .delete(requests)
      .where(and(eq(requests.workspaceId, await this.workspace()), eq(requests.id, id)))
      .run()
  }

  async deleteCopiesBatch(inputs: { id: string; status: string; count: number; groupId?: string; deleteRequest: boolean }[]) {
    await this.database.transaction(async (tx) => {
      const ids = inputs.map(({ id }) => id)
      const active = await tx
        .select({ requestId: operations.requestId })
        .from(operations)
        .where(
          and(eq(operations.workspaceId, await this.workspace()), inArray(operations.requestId, ids), ne(operations.state, 'committed')),
        )
        .limit(1)
        .get()
      if (active) throw new Response('another operation is already running for this request', { status: 409 })
      for (const input of inputs) {
        if (input.deleteRequest) {
          await this.deleteRequest(input.id, tx)
          continue
        }
        if (input.groupId) {
          const grouped = await tx
            .select({ quantity: printGroupItems.quantity })
            .from(printGroupItems)
            .innerJoin(
              printGroups,
              and(eq(printGroups.workspaceId, printGroupItems.workspaceId), eq(printGroups.id, printGroupItems.groupId)),
            )
            .where(
              and(
                eq(printGroupItems.workspaceId, await this.workspace()),
                eq(printGroupItems.groupId, input.groupId),
                eq(printGroupItems.requestId, input.id),
                eq(printGroups.statusId, input.status),
              ),
            )
            .get()
          if (!grouped || grouped.quantity < input.count) throw new Response('invalid group delete', { status: 409 })
          if (grouped.quantity === input.count) {
            await tx
              .delete(printGroupItems)
              .where(
                and(
                  eq(printGroupItems.workspaceId, await this.workspace()),
                  eq(printGroupItems.groupId, input.groupId),
                  eq(printGroupItems.requestId, input.id),
                ),
              )
              .run()
          } else {
            await tx
              .update(printGroupItems)
              .set({ quantity: sql`${printGroupItems.quantity} - ${input.count}` })
              .where(
                and(
                  eq(printGroupItems.workspaceId, await this.workspace()),
                  eq(printGroupItems.groupId, input.groupId),
                  eq(printGroupItems.requestId, input.id),
                  gte(printGroupItems.quantity, input.count),
                ),
              )
              .run()
          }
        } else {
          await this.requireUngroupedQuantity(tx, input.id, input.status, input.count, 'invalid group delete')
        }
        const statusUpdate = await tx
          .update(requestStatuses)
          .set({ quantity: sql`${requestStatuses.quantity} - ${input.count}` })
          .where(
            and(
              eq(requestStatuses.workspaceId, await this.workspace()),
              eq(requestStatuses.requestId, input.id),
              eq(requestStatuses.statusId, input.status),
              gte(requestStatuses.quantity, input.count),
            ),
          )
          .run()
        const requestUpdate = await tx
          .update(requests)
          .set({ quantity: sql`${requests.quantity} - ${input.count}`, updatedAt: Date.now() })
          .where(and(eq(requests.workspaceId, await this.workspace()), eq(requests.id, input.id), gt(requests.quantity, input.count)))
          .run()
        if (statusUpdate.changes !== 1 || requestUpdate.changes !== 1) throw new Response('invalid group delete', { status: 409 })
      }
    })
  }

  async requestsNeedingAssets() {
    return (
      await this.database
        .selectDistinct({ id: requests.id, createdAt: requests.createdAt })
        .from(requests)
        .innerJoin(
          assetGenerationJobs,
          and(eq(assetGenerationJobs.workspaceId, requests.workspaceId), eq(assetGenerationJobs.requestId, requests.id)),
        )
        .where(and(eq(requests.workspaceId, await this.workspace()), inArray(assetGenerationJobs.status, ['pending', 'running'])))
        .orderBy(requests.createdAt)
        .all()
    ).map(({ id }) => id)
  }

  async assetGenerationCandidates(afterId: string | undefined, limit: number) {
    const workspaceId = await this.workspace()
    return (
      await this.database
        .selectDistinct({ id: requests.id })
        .from(requests)
        .leftJoin(
          assetGenerationJobs,
          and(eq(assetGenerationJobs.workspaceId, requests.workspaceId), eq(assetGenerationJobs.requestId, requests.id)),
        )
        .where(
          and(
            eq(requests.workspaceId, workspaceId),
            afterId ? gt(requests.id, afterId) : undefined,
            or(
              inArray(assetGenerationJobs.status, ['pending', 'running']),
              isNull(requests.modelWidthMm),
              isNull(requests.modelDepthMm),
              isNull(requests.modelHeightMm),
            ),
          ),
        )
        .orderBy(requests.id)
        .limit(limit)
        .all()
    ).map(({ id }) => id)
  }

  async queueAssetGeneration(id: string) {
    const request = await this.getRequest(id)
    if (!request) return
    const workspaceId = await this.workspace()
    const now = Date.now()
    await this.database.transaction(async (tx) => {
      const jobs: (typeof assetGenerationJobs.$inferInsert)[] = [
        ...(!request.thumbnailPath
          ? ([{ workspaceId, requestId: id, stage: 'thumbnail', status: 'pending', queuedAt: now }] as const)
          : []),
        ...(!request.previewPath ? ([{ workspaceId, requestId: id, stage: 'preview', status: 'pending', queuedAt: now }] as const) : []),
      ]
      if (jobs.length) {
        await tx.insert(assetGenerationJobs).values(jobs).onConflictDoNothing().run()
        await tx
          .update(requests)
          .set({ assetsGeneratedAt: null })
          .where(and(eq(requests.workspaceId, await this.workspace()), eq(requests.id, id)))
          .run()
      }
    })
  }

  async requeueAssetGeneration(id: string, stages: import('../core/types').AssetGenerationStage[]) {
    const workspaceId = await this.workspace()
    await this.database.transaction(async (tx) => {
      const now = Date.now()
      await tx
        .update(assetGenerationJobs)
        .set({ status: 'pending', error: null, queuedAt: now, startedAt: null, finishedAt: null })
        .where(
          and(
            eq(assetGenerationJobs.workspaceId, workspaceId),
            eq(assetGenerationJobs.requestId, id),
            inArray(assetGenerationJobs.stage, stages),
          ),
        )
        .run()
      await tx
        .update(requests)
        .set({ assetsGeneratedAt: null })
        .where(and(eq(requests.workspaceId, await this.workspace()), eq(requests.id, id)))
        .run()
    })
  }

  async startAssetGeneration(id: string, stages: import('../core/types').AssetGenerationStage[]) {
    const workspaceId = await this.workspace()
    await this.database
      .update(assetGenerationJobs)
      .set({ status: 'running', startedAt: Date.now(), finishedAt: null, error: null })
      .where(
        and(
          eq(assetGenerationJobs.workspaceId, workspaceId),
          eq(assetGenerationJobs.requestId, id),
          inArray(assetGenerationJobs.stage, stages),
          eq(assetGenerationJobs.status, 'pending'),
        ),
      )
      .run()
  }

  async finishAssetGeneration(
    id: string,
    stage: import('../core/types').AssetGenerationStage,
    outcome: { status: 'ready' | 'skipped' | 'failed'; path?: string; error?: string },
  ) {
    const workspaceId = await this.workspace()
    await this.database.transaction(async (tx) => {
      const now = Date.now()
      await tx
        .update(assetGenerationJobs)
        .set({ status: outcome.status, error: outcome.error?.slice(0, 1_000) ?? null, finishedAt: now })
        .where(
          and(
            eq(assetGenerationJobs.workspaceId, workspaceId),
            eq(assetGenerationJobs.requestId, id),
            eq(assetGenerationJobs.stage, stage),
          ),
        )
        .run()
      if (outcome.path) {
        await tx
          .update(requests)
          .set(stage === 'thumbnail' ? { thumbnailPath: outcome.path, updatedAt: now } : { previewPath: outcome.path, updatedAt: now })
          .where(and(eq(requests.workspaceId, await this.workspace()), eq(requests.id, id)))
          .run()
      }
      const unfinished = await tx
        .select({ requestId: assetGenerationJobs.requestId })
        .from(assetGenerationJobs)
        .where(
          and(
            eq(assetGenerationJobs.workspaceId, workspaceId),
            eq(assetGenerationJobs.requestId, id),
            inArray(assetGenerationJobs.status, ['pending', 'running']),
          ),
        )
        .limit(1)
        .get()
      if (!unfinished)
        await tx
          .update(requests)
          .set({ assetsGeneratedAt: now, updatedAt: now })
          .where(and(eq(requests.workspaceId, await this.workspace()), eq(requests.id, id)))
          .run()
    })
  }

  async listAssetGenerationJobs() {
    const workspaceId = await this.workspace()
    return (
      await this.database
        .select({ job: assetGenerationJobs })
        .from(assetGenerationJobs)
        .innerJoin(requests, and(eq(requests.workspaceId, assetGenerationJobs.workspaceId), eq(requests.id, assetGenerationJobs.requestId)))
        .where(eq(assetGenerationJobs.workspaceId, workspaceId))
        .orderBy(assetGenerationJobs.queuedAt, assetGenerationJobs.stage)
        .all()
    ).map(({ job }) => mapAssetGenerationJob(job))
  }

  async assetGenerationJobs(id: string) {
    if (!(await this.getRequest(id))) return []
    const workspaceId = await this.workspace()
    return (
      await this.database
        .select()
        .from(assetGenerationJobs)
        .where(and(eq(assetGenerationJobs.workspaceId, workspaceId), eq(assetGenerationJobs.requestId, id)))
        .orderBy(assetGenerationJobs.stage)
        .all()
    ).map(mapAssetGenerationJob)
  }

  async requeueInterruptedAssetGeneration() {
    const workspaceId = await this.workspace()
    await this.database
      .update(assetGenerationJobs)
      .set({ status: 'pending', queuedAt: Date.now(), startedAt: null, finishedAt: null, error: null })
      .where(and(eq(assetGenerationJobs.workspaceId, workspaceId), eq(assetGenerationJobs.status, 'running')))
      .run()
  }

  async requestsNeedingModelDimensions() {
    return (
      await this.database
        .select({ id: requests.id })
        .from(requests)
        .where(
          and(
            eq(requests.workspaceId, await this.workspace()),
            or(isNull(requests.modelWidthMm), isNull(requests.modelDepthMm), isNull(requests.modelHeightMm)),
          ),
        )
        .orderBy(requests.createdAt)
        .all()
    ).map(({ id }) => id)
  }

  async setModelDimensions(id: string, dimensions: import('../core/types').ModelDimensions) {
    await this.database
      .update(requests)
      .set({
        modelWidthMm: dimensions.widthMm,
        modelDepthMm: dimensions.depthMm,
        modelHeightMm: dimensions.heightMm,
        updatedAt: Date.now(),
      })
      .where(and(eq(requests.workspaceId, await this.workspace()), eq(requests.id, id)))
      .run()
    await this.backfillAutomaticPrinterAssignments([id])
  }

  async completeAssetGeneration(id: string, generated: { thumbnailPath?: string; previewPath?: string }) {
    const workspaceId = await this.workspace()
    const now = Date.now()
    await this.database.transaction(async (tx) => {
      await tx
        .update(requests)
        .set({
          ...(generated.thumbnailPath ? { thumbnailPath: generated.thumbnailPath } : {}),
          ...(generated.previewPath ? { previewPath: generated.previewPath } : {}),
          assetsGeneratedAt: now,
          updatedAt: now,
        })
        .where(and(eq(requests.workspaceId, await this.workspace()), eq(requests.id, id)))
        .run()
      await tx
        .update(assetGenerationJobs)
        .set({ status: generated.thumbnailPath ? 'ready' : 'failed', finishedAt: now })
        .where(
          and(
            eq(assetGenerationJobs.workspaceId, workspaceId),
            eq(assetGenerationJobs.requestId, id),
            eq(assetGenerationJobs.stage, 'thumbnail'),
          ),
        )
        .run()
      await tx
        .update(assetGenerationJobs)
        .set({ status: generated.previewPath ? 'ready' : 'skipped', finishedAt: now })
        .where(
          and(
            eq(assetGenerationJobs.workspaceId, workspaceId),
            eq(assetGenerationJobs.requestId, id),
            eq(assetGenerationJobs.stage, 'preview'),
          ),
        )
        .run()
    })
  }

  async listPeople() {
    const workspaceId = await this.workspace()
    return (
      await this.database
        .select({ id: user.id, name: user.name, color: user.color })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(eq(member.organizationId, workspaceId))
        .orderBy(user.name, user.id)
        .all()
    ).map((row) => ({ id: row.id, name: row.name, color: row.color ?? undefined }))
  }

  async listUsers() {
    const workspaceId = await this.workspace()
    return (
      await this.database
        .select({ id: user.id, email: user.email, name: user.name, image: user.image, role: member.role })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(eq(member.organizationId, workspaceId))
        .orderBy(sql`CASE ${member.role} WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END`, sql`lower(${user.name})`)
        .all()
    ).map((row) => ({
      ...mapUserIdentity(row),
      role: row.role === 'owner' || row.role === 'admin' ? ('admin' as const) : ('requester' as const),
      workspaceRole: row.role,
    }))
  }

  async listAccounts() {
    const activity = this.database
      .select({ userId: authSession.userId, lastOnlineAt: max(authSession.updatedAt).as('last_online_at') })
      .from(authSession)
      .groupBy(authSession.userId)
      .as('account_activity')
    const memberships = this.database
      .select({ userId: member.userId, workspaceCount: count(member.id).as('workspace_count') })
      .from(member)
      .groupBy(member.userId)
      .as('account_memberships')
    return (
      await this.database
        .select({
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
          lastOnlineAt: activity.lastOnlineAt,
          workspaceCount: memberships.workspaceCount,
        })
        .from(user)
        .leftJoin(activity, eq(activity.userId, user.id))
        .leftJoin(memberships, eq(memberships.userId, user.id))
        .orderBy(sql`CASE ${user.role} WHEN 'super_admin' THEN 0 ELSE 1 END`, sql`lower(${user.name})`)
        .all()
    ).map((row) => ({
      ...mapUserIdentity(row),
      role: row.role === 'super_admin' ? ('super_admin' as const) : ('requester' as const),
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
      lastOnlineAt: row.lastOnlineAt?.getTime(),
      workspaceCount: row.workspaceCount ?? 0,
    }))
  }

  async accountExists(email: string) {
    return Boolean(
      await this.database
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, normalizeEmail(email)))
        .get(),
    )
  }

  async getDeploymentSetting<T>(key: string): Promise<T | undefined> {
    const row = await this.database
      .select({ value: deploymentSettings.valueJson })
      .from(deploymentSettings)
      .where(eq(deploymentSettings.key, key))
      .get()
    return row ? (JSON.parse(row.value) as T) : undefined
  }

  async setDeploymentSetting(key: string, value: unknown) {
    const values = { key, valueJson: JSON.stringify(value), updatedAt: Date.now() }
    await this.database.insert(deploymentSettings).values(values).onConflictDoUpdate({ target: deploymentSettings.key, set: values }).run()
  }

  async queueManagedStorageDeletion(workspaceId: string) {
    await this.updateManagedStorageDeletionQueue((workspaceIds) =>
      workspaceIds.includes(workspaceId) ? workspaceIds : [...workspaceIds, workspaceId],
    )
  }

  async completeManagedStorageDeletion(workspaceId: string) {
    await this.updateManagedStorageDeletionQueue((workspaceIds) => workspaceIds.filter((id) => id !== workspaceId))
  }

  async managedStorageDeletionQueue() {
    return (await this.getDeploymentSetting<string[]>(MANAGED_STORAGE_DELETION_QUEUE)) ?? []
  }

  private async updateManagedStorageDeletionQueue(update: (workspaceIds: string[]) => string[]) {
    await this.database.transaction(async (tx) => {
      const initial = {
        key: MANAGED_STORAGE_DELETION_QUEUE,
        valueJson: '[]',
        updatedAt: Date.now(),
      }
      await tx.insert(deploymentSettings).values(initial).onConflictDoNothing().run()
      await tx
        .update(deploymentSettings)
        .set({ valueJson: sql`${deploymentSettings.valueJson}` })
        .where(eq(deploymentSettings.key, MANAGED_STORAGE_DELETION_QUEUE))
        .run()
      const row = await tx
        .select({ valueJson: deploymentSettings.valueJson })
        .from(deploymentSettings)
        .where(eq(deploymentSettings.key, MANAGED_STORAGE_DELETION_QUEUE))
        .get()
      const valueJson = JSON.stringify(update(row ? (JSON.parse(row.valueJson) as string[]) : []))
      await tx
        .update(deploymentSettings)
        .set({ valueJson, updatedAt: Date.now() })
        .where(eq(deploymentSettings.key, MANAGED_STORAGE_DELETION_QUEUE))
        .run()
    })
  }

  async getSetting<T>(key: string): Promise<T | undefined> {
    return await this.getSettingFrom<T>(this.database, key)
  }

  async listAssetMigrations() {
    return (
      await this.database
        .select({ id: assetMigrations.id })
        .from(assetMigrations)
        .where(eq(assetMigrations.workspaceId, await this.workspace()))
        .orderBy(assetMigrations.id)
        .all()
    ).map(({ id }) => id)
  }

  async recordAssetMigration(id: string) {
    await this.database
      .insert(assetMigrations)
      .values({ workspaceId: await this.workspace(), id, appliedAt: Date.now() })
      .onConflictDoNothing()
      .run()
  }

  async setSetting(key: string, value: unknown) {
    await this.setSettingWith(this.database, key, value)
  }

  async deleteSetting(key: string) {
    await this.database
      .delete(settings)
      .where(and(eq(settings.workspaceId, await this.workspace()), eq(settings.key, key)))
      .run()
  }

  async setSettings(values: Record<string, unknown>, deleteKeys: string[] = []) {
    await this.database.transaction(async (tx) => {
      await this.setSettingsWith(tx, values, deleteKeys)
    })
  }

  async setSettingsAndReleaseManagedStorage(values: Record<string, unknown>, deleteKeys: string[] = []) {
    await this.database.transaction(async (tx) => {
      await this.setSettingsWith(tx, values, deleteKeys)
      await tx
        .delete(managedStorageEntitlements)
        .where(eq(managedStorageEntitlements.workspaceId, await this.workspace()))
        .run()
    })
  }

  async replacePrinterProfiles(profiles: PrinterProfile[]) {
    await this.database.transaction(async (tx) => {
      const previous = ((await this.getSettingFrom<PrinterProfile[]>(tx, PRINTERS_SETTING)) ?? []).map(normalizePrinterProfile)
      const next = profiles.map(normalizePrinterProfile)
      const nextById = new Map(next.map((profile) => [profile.id, profile]))

      const now = Date.now()
      for (const profile of previous) {
        const replacement = nextById.get(profile.id)
        if (!replacement) {
          await tx
            .update(requests)
            .set({ printerId: null, printType: profile.printType, updatedAt: now })
            .where(and(eq(requests.workspaceId, await this.workspace()), eq(requests.printerId, profile.id)))
            .run()
          continue
        }
        if (profile.printType !== replacement.printType) {
          await tx
            .update(requests)
            .set({ printType: null, updatedAt: now })
            .where(and(eq(requests.workspaceId, await this.workspace()), eq(requests.printerId, profile.id)))
            .run()
        }
      }
      await tx
        .update(requests)
        .set({ printType: null })
        .where(and(eq(requests.workspaceId, await this.workspace()), isNotNull(requests.printerId)))
        .run()

      await this.setSettingWith(tx, PRINTERS_SETTING, next)
    })
    await this.backfillAutomaticPrinterAssignments()
  }

  private async backfillPrinterPresetIds() {
    const workspaceIds = this.workspaceId
      ? [this.workspaceId]
      : (await this.database.select({ id: organization.id }).from(organization).orderBy(organization.createdAt).all()).map(({ id }) => id)

    for (const workspaceId of workspaceIds) {
      const repository = this.workspaceId === workspaceId ? this : await this.scoped(workspaceId)
      const stored = await repository.getSetting<PrinterProfile[]>(PRINTERS_SETTING)
      if (!stored) continue
      const normalized = stored.map(normalizePrinterProfile)
      if (normalized.some((profile, index) => profile.presetId !== stored[index]?.presetId)) {
        await repository.setSetting(PRINTERS_SETTING, normalized)
      }
    }
  }

  private async backfillAutomaticPrinterAssignments(requestIds?: string[]) {
    const workspaceIds = this.workspaceId
      ? [this.workspaceId]
      : (await this.database.select({ id: organization.id }).from(organization).orderBy(organization.createdAt).all()).map(({ id }) => id)

    for (const workspaceId of workspaceIds) {
      const repository = this.workspaceId === workspaceId ? this : await this.scoped(workspaceId)
      const profiles = await storedPrinterProfiles(repository)
      if (!profiles.length) continue
      const existingRequests = await repository.listRequests()
      const automatic = existingRequests
        .filter(
          (request) =>
            (!requestIds || requestIds.includes(request.id)) && (request.automaticPrinterAssignment || request.requestedPrintType),
        )
        .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))

      for (const request of automatic) {
        const printType = request.printerId
          ? profiles.find((profile) => profile.id === request.printerId)?.printType
          : request.requestedPrintType
        if (!printType) continue
        const printer = automaticallyAssignedPrinter(profiles, existingRequests, printType, request.id, request.modelDimensions)
        const printerId = printer?.id
        const requestedPrintType = printer ? undefined : printType
        if (request.printerId !== printerId || request.requestedPrintType !== requestedPrintType || !request.automaticPrinterAssignment) {
          await repository.updateRequest(request.id, {
            printerId: printerId ?? null,
            requestedPrintType: requestedPrintType ?? null,
            automaticPrinterAssignment: true,
          })
        }
        request.printerId = printerId
        request.requestedPrintType = requestedPrintType
        request.automaticPrinterAssignment = true
      }
    }
  }

  async countUsers() {
    return (await this.database.select({ count: count() }).from(user).get())?.count ?? 0
  }

  async getUserOnboarding(userId: string, workspaceId?: string): Promise<OnboardingProgress> {
    const [userProgress, workspaceProgress] = await Promise.all([
      this.database.select().from(userOnboarding).where(eq(userOnboarding.userId, userId)).get(),
      workspaceId
        ? this.database
            .select()
            .from(workspaceOnboarding)
            .where(and(eq(workspaceOnboarding.workspaceId, workspaceId), eq(workspaceOnboarding.userId, userId)))
            .get()
        : undefined,
    ])
    return {
      completedTasks: [
        ...onboardingTasksForScope(parseOnboardingTasks(userProgress?.completedTasks ?? '[]'), 'user'),
        ...onboardingTasksForScope(parseOnboardingTasks(workspaceProgress?.completedTasks ?? '[]'), 'workspace'),
      ],
      skippedTasks: [
        ...onboardingTasksForScope(parseOnboardingTasks(userProgress?.skippedTasks ?? '[]'), 'user'),
        ...onboardingTasksForScope(parseOnboardingTasks(workspaceProgress?.skippedTasks ?? '[]'), 'workspace'),
      ],
      celebratedTasks: [
        ...onboardingTasksForScope(parseOnboardingTasks(userProgress?.celebratedTasks ?? '[]'), 'user'),
        ...onboardingTasksForScope(parseOnboardingTasks(workspaceProgress?.celebratedTasks ?? '[]'), 'workspace'),
      ],
    }
  }

  async saveUserOnboarding(userId: string, progress: OnboardingProgress, workspaceId?: string) {
    const userValues = {
      userId,
      completedTasks: JSON.stringify(onboardingTasksForScope(progress.completedTasks, 'user')),
      skippedTasks: JSON.stringify(onboardingTasksForScope(progress.skippedTasks, 'user')),
      celebratedTasks: JSON.stringify(onboardingTasksForScope(progress.celebratedTasks, 'user')),
      updatedAt: Date.now(),
    }
    await this.database.transaction(async (transaction) => {
      await transaction
        .insert(userOnboarding)
        .values(userValues)
        .onConflictDoUpdate({ target: userOnboarding.userId, set: userValues })
        .run()
      if (!workspaceId) return
      const workspaceValues = {
        workspaceId,
        userId,
        completedTasks: JSON.stringify(onboardingTasksForScope(progress.completedTasks, 'workspace')),
        skippedTasks: JSON.stringify(onboardingTasksForScope(progress.skippedTasks, 'workspace')),
        celebratedTasks: JSON.stringify(onboardingTasksForScope(progress.celebratedTasks, 'workspace')),
        updatedAt: Date.now(),
      }
      await transaction
        .insert(workspaceOnboarding)
        .values(workspaceValues)
        .onConflictDoUpdate({ target: [workspaceOnboarding.workspaceId, workspaceOnboarding.userId], set: workspaceValues })
        .run()
    })
  }

  async countOwnedWorkspaces(userId: string) {
    return await this.countOwnedWorkspacesWith(this.database, userId)
  }

  async listWorkspacesForUser(userId: string): Promise<import('../core/types').WorkspaceSummary[]> {
    return await this.database
      .select({ id: organization.id, name: organization.name, slug: organization.slug, role: member.role })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(eq(member.userId, userId))
      .orderBy(organization.name, organization.id)
      .all()
  }

  async listWorkspaces() {
    return await this.database.select({ id: organization.id, name: organization.name, slug: organization.slug }).from(organization).all()
  }

  async workspaceById(id: string) {
    return await this.database
      .select({ id: organization.id, name: organization.name, slug: organization.slug })
      .from(organization)
      .where(eq(organization.id, id))
      .get()
  }

  async workspaceForUser(userId: string, slug: string) {
    return await this.database
      .select({ id: organization.id, name: organization.name, slug: organization.slug, role: member.role })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(and(eq(member.userId, userId), eq(organization.slug, slug)))
      .get()
  }

  async workspaceBySlug(slug: string) {
    return await this.database
      .select({ id: organization.id, name: organization.name, slug: organization.slug })
      .from(organization)
      .where(eq(organization.slug, slug))
      .get()
  }

  async isPersonalWorkspace(userId: string, workspaceId: string) {
    return Boolean(
      await this.database
        .select({ id: organization.id })
        .from(organization)
        .where(and(eq(organization.id, workspaceId), eq(organization.personalOwnerId, userId)))
        .get(),
    )
  }

  async setPersonalWorkspace(userId: string, workspaceId: string) {
    await this.database.transaction(async (tx) => {
      const owned = await tx
        .select({ id: organization.id })
        .from(organization)
        .innerJoin(member, and(eq(member.organizationId, organization.id), eq(member.userId, userId), eq(member.role, 'owner')))
        .where(eq(organization.id, workspaceId))
        .get()
      if (!owned) throw new Response('workspace not found', { status: 404 })
      await tx.update(organization).set({ personalOwnerId: null }).where(eq(organization.personalOwnerId, userId)).run()
      await tx.update(organization).set({ personalOwnerId: userId }).where(eq(organization.id, workspaceId)).run()
    })
  }

  async addWorkspaceMember(userId: string, role: import('../core/types').WorkspaceRole) {
    await this.addWorkspaceMemberWith(this.database, await this.workspace(), userId, role)
  }

  async claimInviteGlobally(tokenHash: string, now: number, email: string) {
    const row = await this.database
      .update(invites)
      .set({ usedAt: now })
      .where(
        and(
          eq(invites.tokenHash, tokenHash),
          isNull(invites.usedAt),
          gt(invites.expiresAt, now),
          or(isNull(invites.recipientEmail), eq(invites.recipientEmail, normalizeEmail(email))),
        ),
      )
      .returning()
      .get()
    return row
      ? {
          id: row.id,
          workspaceId: row.workspaceId,
          role: row.role,
          label: row.label ?? undefined,
          recipientEmail: row.recipientEmail ?? undefined,
          createdAt: row.createdAt,
          expiresAt: row.expiresAt,
          usedAt: row.usedAt!,
        }
      : undefined
  }

  async workspaceSlugForInvite(tokenHash: string, _now: number) {
    return (
      await this.database
        .select({ slug: organization.slug })
        .from(invites)
        .innerJoin(organization, eq(organization.id, invites.workspaceId))
        .where(eq(invites.tokenHash, tokenHash))
        .get()
    )?.slug
  }

  async completeInviteGlobally(id: string, userId: string) {
    const invite = await this.database.select().from(invites).where(eq(invites.id, id)).get()
    if (!invite) return
    await this.database.transaction(async (tx) => {
      await tx.update(invites).set({ usedBy: userId }).where(eq(invites.id, id)).run()
      await this.addWorkspaceMemberWith(tx, invite.workspaceId, userId, invite.role === 'admin' ? 'admin' : 'member')
    })
  }

  async ensurePersonalWorkspace(identity: { id: string; name: string }) {
    const existing = await this.database
      .select({ id: organization.id, name: organization.name, slug: organization.slug, role: member.role })
      .from(organization)
      .innerJoin(member, and(eq(member.organizationId, organization.id), eq(member.userId, identity.id)))
      .where(eq(organization.personalOwnerId, identity.id))
      .get()
    if (existing) return existing
    if ((await this.listWorkspacesForUser(identity.id)).length > 0) return undefined
    if (process.env.NODE_ENV === 'test') {
      const testWorkspace = await this.workspaceBySlug('test-workspace')
      if (testWorkspace) {
        const scoped = await this.scoped(testWorkspace.id)
        await scoped.addWorkspaceMember(identity.id, 'owner')
        await this.database.update(organization).set({ personalOwnerId: identity.id }).where(eq(organization.id, testWorkspace.id)).run()
        return { ...testWorkspace, role: 'owner' as const }
      }
    }

    return await this.database.transaction(async (tx) => {
      const concurrent = await tx
        .select({ id: organization.id, name: organization.name, slug: organization.slug, role: member.role })
        .from(organization)
        .innerJoin(member, and(eq(member.organizationId, organization.id), eq(member.userId, identity.id)))
        .where(eq(organization.personalOwnerId, identity.id))
        .get()
      if (concurrent) return concurrent
      const membership = await tx.select({ id: member.id }).from(member).where(eq(member.userId, identity.id)).get()
      if (membership) return undefined

      const name = identity.name.trim() ? `${identity.name.trim()}'s workspace` : 'My workspace'
      return await this.createOwnedWorkspace(tx, identity.id, name, { personalOwnerId: identity.id, slugName: identity.name })
    })
  }

  async createWorkspace(
    identity: { id: string },
    requestedName: string,
    initialSettings: Record<string, unknown> = {},
    maxOwnedWorkspaces?: number,
  ) {
    return await this.database.transaction(async (tx) => {
      if (maxOwnedWorkspaces !== undefined) {
        await this.lockUserRow(tx, identity.id)
        const owned = await this.countOwnedWorkspacesWith(tx, identity.id)
        if (owned >= maxOwnedWorkspaces)
          throw new Response(`hosted accounts can own up to ${maxOwnedWorkspaces} workspaces`, { status: 409 })
      }
      const name = requestedName.trim()
      return await this.createOwnedWorkspace(tx, identity.id, name, { initialSettings })
    })
  }

  private async createOwnedWorkspace(
    database: DatabaseExecutor,
    userId: string,
    name: string,
    options: { personalOwnerId?: string; slugName?: string; initialSettings?: Record<string, unknown> } = {},
  ) {
    const id = crypto.randomUUID()
    const slug = await this.availableWorkspaceSlug(database, options.slugName ?? name)
    const createdAt = new Date()
    await database.insert(organization).values({ id, name, slug, personalOwnerId: options.personalOwnerId, createdAt }).run()
    await this.addWorkspaceMemberWith(database, id, userId, 'owner', createdAt)
    for (const [key, value] of Object.entries(options.initialSettings ?? {})) {
      await database
        .insert(settings)
        .values({ workspaceId: id, key, valueJson: JSON.stringify(value), updatedAt: Date.now() })
        .run()
    }
    return { id, name, slug, role: 'owner' as const }
  }

  private async addWorkspaceMemberWith(
    database: DatabaseExecutor,
    workspaceId: string,
    userId: string,
    role: import('../core/types').WorkspaceRole,
    createdAt = new Date(),
  ) {
    await database
      .insert(member)
      .values({ id: crypto.randomUUID(), organizationId: workspaceId, userId, role, createdAt })
      .onConflictDoNothing()
      .run()
  }

  private async availableWorkspaceSlug(database: DatabaseExecutor, name: string) {
    const base = workspaceSlug(name)
    let slug = base
    for (
      let suffix = 2;
      await database.select({ id: organization.id }).from(organization).where(eq(organization.slug, slug)).get();
      suffix++
    ) {
      slug = `${base}-${suffix}`
    }
    return slug
  }

  private async lockUserRow(database: DatabaseExecutor, userId: string) {
    await database
      .update(user)
      .set({ name: sql`${user.name}` })
      .where(eq(user.id, userId))
      .run()
  }

  private async countOwnedWorkspacesWith(database: DatabaseExecutor, userId: string) {
    return (
      (
        await database
          .select({ count: count() })
          .from(member)
          .where(and(eq(member.userId, userId), eq(member.role, 'owner')))
          .get()
      )?.count ?? 0
    )
  }

  async setWorkspaceMemberRole(userId: string, role: import('../core/types').WorkspaceRole) {
    const current = await this.database
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, await this.workspace()), eq(member.userId, userId)))
      .get()
    if (!current) throw new Response('member not found', { status: 404 })
    if (current.role === 'owner') throw new Response('transfer workspace ownership before changing the owner role', { status: 409 })
    if (role === 'owner') throw new Response('ownership transfer is not supported here', { status: 400 })
    await this.database
      .update(member)
      .set({ role })
      .where(and(eq(member.organizationId, await this.workspace()), eq(member.userId, userId)))
      .run()
  }

  async removeWorkspaceMember(userId: string) {
    const current = await this.database
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, await this.workspace()), eq(member.userId, userId)))
      .get()
    if (!current) return
    if (current.role === 'owner') throw new Response('the workspace owner cannot be removed', { status: 409 })
    await this.database
      .delete(member)
      .where(and(eq(member.organizationId, await this.workspace()), eq(member.userId, userId)))
      .run()
  }

  async createInvite(invite: { id: string; tokenHash: string; role: Role; label?: string; recipientEmail?: string; expiresAt: number }) {
    const workspaceId = await this.workspace()
    await this.database
      .insert(invites)
      .values({
        id: invite.id,
        workspaceId,
        tokenHash: invite.tokenHash,
        role: invite.role,
        label: invite.label,
        recipientEmail: invite.recipientEmail,
        createdAt: Date.now(),
        expiresAt: invite.expiresAt,
      })
      .run()
  }

  async listInvites() {
    const workspaceId = await this.workspace()
    return (
      await this.database.select().from(invites).where(eq(invites.workspaceId, workspaceId)).orderBy(desc(invites.createdAt)).all()
    ).map(mapInvite)
  }

  async findInvite(tokenHash: string) {
    const workspaceId = await this.workspace()
    const row = await this.database
      .select()
      .from(invites)
      .where(and(eq(invites.workspaceId, workspaceId), eq(invites.tokenHash, tokenHash)))
      .get()
    return row ? mapInvite(row) : undefined
  }

  async claimInvite(tokenHash: string, now: number) {
    const workspaceId = await this.workspace()
    const row = await this.database
      .update(invites)
      .set({ usedAt: now })
      .where(
        and(eq(invites.workspaceId, workspaceId), eq(invites.tokenHash, tokenHash), isNull(invites.usedAt), gt(invites.expiresAt, now)),
      )
      .returning()
      .get()
    return row ? mapInvite(row) : undefined
  }

  async completeInvite(id: string, userId: string) {
    await this.database
      .update(invites)
      .set({ usedBy: userId })
      .where(and(eq(invites.workspaceId, await this.workspace()), eq(invites.id, id)))
      .run()
  }

  async acceptInviteForUser(tokenHash: string, now: number, identity: { id: string; email: string }) {
    const workspaceId = await this.workspace()
    return await this.database.transaction(async (tx) => {
      const invite = await tx
        .select()
        .from(invites)
        .where(
          and(eq(invites.workspaceId, workspaceId), eq(invites.tokenHash, tokenHash), isNull(invites.usedAt), gt(invites.expiresAt, now)),
        )
        .get()
      if (!invite) return undefined
      if (invite.recipientEmail && invite.recipientEmail !== normalizeEmail(identity.email)) {
        throw new Response('this invitation belongs to another account', { status: 403 })
      }
      await tx.update(invites).set({ usedAt: now, usedBy: identity.id }).where(eq(invites.id, invite.id)).run()
      await this.addWorkspaceMemberWith(tx, workspaceId, identity.id, invite.role === 'admin' ? 'admin' : 'member')
      return { ...mapInvite(invite), usedAt: now }
    })
  }

  async deleteInvite(id: string) {
    await this.database
      .delete(invites)
      .where(and(eq(invites.workspaceId, await this.workspace()), eq(invites.id, id), isNull(invites.usedAt)))
      .run()
  }

  async beginOperation(id: string, payload: OperationPayload) {
    if (payload.kind === 'upload') return await this.beginUploadOperation(id, payload)
    const now = Date.now()
    const workspaceId = await this.workspace()
    const request = await this.database
      .select({ id: requests.id })
      .from(requests)
      .where(and(eq(requests.workspaceId, workspaceId), eq(requests.id, payload.requestId)))
      .get()
    if (!request) throw new Response('request not found', { status: 404 })
    try {
      await this.database
        .insert(operations)
        .values({
          id,
          workspaceId,
          kind: payload.kind,
          requestId: payload.requestId,
          payloadJson: JSON.stringify(payload),
          state: 'prepared',
          createdAt: now,
          updatedAt: now,
        })
        .run()
    } catch (error) {
      if (this.backend.isUniqueConstraintError(error))
        throw new Response('another operation is already running for this request', { status: 409 })
      throw error
    }
  }

  async beginUploadOperation(id: string, payload: UploadOperation) {
    const now = Date.now()
    await this.database.transaction(async (tx) => {
      const completed = await this.getCompletedUploadFrom(tx, payload.uploadId, payload.ownerId)
      if (completed) return
      const upload = await tx
        .select({ id: uploadSessions.id })
        .from(uploadSessions)
        .where(
          and(
            eq(uploadSessions.workspaceId, await this.workspace()),
            eq(uploadSessions.id, payload.uploadId),
            eq(uploadSessions.ownerId, payload.ownerId),
          ),
        )
        .get()
      if (!upload) throw new Response('upload session not found', { status: 404 })
      await tx
        .insert(operations)
        .values({
          id,
          workspaceId: await this.workspace(),
          kind: payload.kind,
          requestId: payload.requestId,
          uploadId: payload.uploadId,
          payloadJson: JSON.stringify(payload),
          state: 'prepared',
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .run()
    })
  }

  async markOperationAssetsMoved(id: string) {
    await this.database
      .update(operations)
      .set({ state: 'assets_moved', updatedAt: Date.now() })
      .where(and(eq(operations.workspaceId, await this.workspace()), eq(operations.id, id), eq(operations.state, 'prepared')))
      .run()
  }

  async completeMoveOperation(
    id: string,
    input: { id: string; from: string; to: string; count: number; filePath: string; order?: number; movedAt?: number },
  ) {
    await this.database.transaction(async (tx) => {
      const operation = await this.operationForCompletion(tx, id, 'move')
      if (!operation) return
      const storedInput = {
        id: operation.payload.requestId,
        from: operation.payload.fromStatus,
        to: operation.payload.toStatus,
        count: operation.payload.count,
        filePath: operation.payload.destinationPath,
        order: operation.payload.order,
        movedAt: operation.payload.movedAt,
      }
      if (
        input.id !== storedInput.id ||
        input.from !== storedInput.from ||
        input.to !== storedInput.to ||
        input.count !== storedInput.count ||
        input.filePath !== storedInput.filePath ||
        input.order !== storedInput.order ||
        input.movedAt !== storedInput.movedAt
      )
        throw new Error('operation payload mismatch')
      if (operation.state === 'committed') return
      await this.moveCopies(storedInput, tx)
      await tx
        .update(operations)
        .set({ state: 'committed', updatedAt: Date.now() })
        .where(and(eq(operations.workspaceId, await this.workspace()), eq(operations.id, id)))
        .run()
    })
  }

  async completeDeleteOperation(id: string, requestId: string) {
    await this.database.transaction(async (tx) => {
      const operation = await this.operationForCompletion(tx, id, 'delete')
      if (!operation) return
      if (requestId !== operation.payload.requestId) throw new Error('operation payload mismatch')
      if (operation.state === 'committed') return
      await this.deleteRequest(operation.payload.requestId, tx)
      await tx
        .update(operations)
        .set({ state: 'committed', updatedAt: Date.now() })
        .where(and(eq(operations.workspaceId, await this.workspace()), eq(operations.id, id)))
        .run()
    })
  }

  async completeUploadOperation(id: string, payload: UploadOperation) {
    return await this.database.transaction(async (tx) => {
      const operation = await this.operationForCompletion(tx, id, 'upload')
      if (!operation) throw new Error('upload operation is missing')
      const normalizedPayload = JSON.parse(JSON.stringify(payload)) as UploadOperation
      if (!isDeepStrictEqual(normalizedPayload, operation.payload)) throw new Error('operation payload mismatch')
      const completed = await this.getCompletedUploadFrom(tx, operation.payload.uploadId, operation.payload.ownerId)
      if (completed) return completed
      await this.insertRequest(tx, operation.payload.requestId, {
        ...operation.payload.request,
        filePath: operation.payload.destinationPath,
      })
      await tx
        .update(uploadSessions)
        .set({ completedRequestId: operation.payload.requestId, bytes: 0 })
        .where(
          and(
            eq(uploadSessions.workspaceId, await this.workspace()),
            eq(uploadSessions.id, operation.payload.uploadId),
            eq(uploadSessions.ownerId, operation.payload.ownerId),
          ),
        )
        .run()
      await tx
        .update(operations)
        .set({ state: 'committed', updatedAt: Date.now() })
        .where(and(eq(operations.workspaceId, await this.workspace()), eq(operations.id, id)))
        .run()
      return operation.payload.requestId
    })
  }

  async completeRepeatOperation(id: string, payload: RepeatOperation) {
    return await this.database.transaction(async (tx) => {
      const operation = await this.operationForCompletion(tx, id, 'repeat')
      if (!operation) throw new Error('repeat operation is missing')
      const normalizedPayload = JSON.parse(JSON.stringify(payload)) as RepeatOperation
      if (!isDeepStrictEqual(normalizedPayload, operation.payload)) throw new Error('operation payload mismatch')
      const existing = await this.getRequestFrom(tx, operation.payload.newRequestId)
      if (!existing) {
        await this.insertRequest(tx, operation.payload.newRequestId, {
          ...operation.payload.request,
          filePath: operation.payload.destinationPath,
        })
      }
      await tx
        .update(operations)
        .set({ state: 'committed', updatedAt: Date.now() })
        .where(and(eq(operations.workspaceId, await this.workspace()), eq(operations.id, id)))
        .run()
      return operation.payload.newRequestId
    })
  }

  private async operationForCompletion<K extends OperationPayload['kind']>(database: DatabaseExecutor, id: string, kind: K) {
    const operation = await database
      .select({ kind: operations.kind, state: operations.state, payloadJson: operations.payloadJson })
      .from(operations)
      .where(and(eq(operations.workspaceId, await this.workspace()), eq(operations.id, id)))
      .get()
    if (!operation) return undefined
    const payload = parseOperationPayload(operation.payloadJson)
    if (operation.kind !== kind || payload.kind !== kind) throw new Error('operation kind mismatch')
    return { state: operation.state, payload: payload as Extract<OperationPayload, { kind: K }> }
  }

  async listOperations() {
    return (
      await this.database
        .select({ id: operations.id, state: operations.state, payloadJson: operations.payloadJson })
        .from(operations)
        .where(eq(operations.workspaceId, await this.workspace()))
        .orderBy(operations.createdAt)
        .all()
    ).map((row) => ({
      id: row.id,
      state: row.state,
      payload: parseOperationPayload(row.payloadJson),
    }))
  }

  async finishOperation(id: string) {
    await this.database
      .delete(operations)
      .where(and(eq(operations.workspaceId, await this.workspace()), eq(operations.id, id), eq(operations.state, 'committed')))
      .run()
  }
  async abandonOperation(id: string) {
    const workspaceId = await this.workspace()
    await this.database.transaction(async (tx) => {
      const row = await tx
        .select({ payloadJson: operations.payloadJson })
        .from(operations)
        .where(and(eq(operations.workspaceId, workspaceId), eq(operations.id, id)))
        .get()
      await tx
        .delete(operations)
        .where(and(eq(operations.workspaceId, workspaceId), eq(operations.id, id)))
        .run()
      if (!row) return
      const payload = parseOperationPayload(row.payloadJson)
      if (payload.kind !== 'upload') return
      // Nothing landed at the destination, so the finalize reservation has to go back to the
      // account; otherwise the session keeps it forever and expireUploads never reclaims the row.
      const ownerId = await this.managedStorageOwner(tx)
      if (!ownerId) return
      await this.lockManagedStorageAccount(tx, ownerId)
      await this.settleUploadFinalize(tx, workspaceId, ownerId, payload.uploadId, 0)
    })
  }

  private async hydrate(database: DatabaseExecutor, row: RequestRow) {
    const states = await database
      .select()
      .from(requestStatuses)
      .where(and(eq(requestStatuses.workspaceId, row.workspaceId), eq(requestStatuses.requestId, row.id)))
      .all()
    return mapRequest(row, states)
  }

  private async hydrateRows(rows: RequestRow[]) {
    if (rows.length === 0) return []
    const states = await this.database
      .select()
      .from(requestStatuses)
      .where(
        and(
          eq(requestStatuses.workspaceId, await this.workspace()),
          inArray(
            requestStatuses.requestId,
            rows.map((row) => row.id),
          ),
        ),
      )
      .all()
    const byRequest = new Map<string, typeof states>()
    for (const state of states) {
      const current = byRequest.get(state.requestId) ?? []
      current.push(state)
      byRequest.set(state.requestId, current)
    }
    return rows.map((row) => mapRequest(row, byRequest.get(row.id) ?? []))
  }

  private async requestConditions(filters: RequestFilters, query: RequestQuery, options: RequestFilterOptions = {}) {
    const profiles = filters.printType ? await storedPrinterProfiles(this) : []
    return requestConditions(await this.workspace(), filters, query, profiles, options)
  }
  private async insertRequest(db: DatabaseExecutor, id: string, request: NewPrintRequest) {
    const now = Date.now()
    const workspaceId = await this.workspace()
    await db
      .insert(requests)
      .values({
        id,
        workspaceId,
        name: request.name,
        fileName: request.fileName,
        filePath: request.filePath,
        quantity: request.quantity,
        ownerUserId: request.ownerUserId,
        notes: request.notes,
        sourceUrl: request.sourceUrl,
        thumbnailPath: request.thumbnailPath,
        previewPath: request.previewPath,
        printType: request.printerId ? null : request.requestedPrintType,
        printerId: request.printerId,
        automaticPrinterAssignment: request.automaticPrinterAssignment ?? false,
        createdAt: now,
        updatedAt: now,
      })
      .run()
    await db
      .insert(requestStatuses)
      .values(
        workflow.statuses.map((status) => ({
          workspaceId,
          requestId: id,
          statusId: status.id,
          quantity: status.id === initialStatus().id ? request.quantity : 0,
        })),
      )
      .run()
    await db
      .insert(assetGenerationJobs)
      .values([
        {
          workspaceId,
          requestId: id,
          stage: 'thumbnail',
          status: request.thumbnailPath ? 'ready' : 'pending',
          queuedAt: now,
          finishedAt: request.thumbnailPath ? now : null,
        },
        {
          workspaceId,
          requestId: id,
          stage: 'preview',
          status: request.previewPath ? 'ready' : 'pending',
          queuedAt: now,
          finishedAt: request.previewPath ? now : null,
        },
      ])
      .run()
  }

  async reconcileWorkflow() {
    await this.database.transaction(async (tx) => {
      const workspaceId = await this.workspace()
      const configured = new Set(workflow.statuses.map((status) => status.id))
      const workspaceRequestIds = tx.select({ id: requests.id }).from(requests).where(eq(requests.workspaceId, workspaceId))
      const existing = await tx
        .selectDistinct({ statusId: requestStatuses.statusId })
        .from(requestStatuses)
        .where(and(eq(requestStatuses.workspaceId, workspaceId), inArray(requestStatuses.requestId, workspaceRequestIds)))
        .all()
      for (const { statusId } of existing) {
        if (configured.has(statusId)) continue
        const used = await tx
          .select({ requestId: requestStatuses.requestId })
          .from(requestStatuses)
          .where(
            and(
              inArray(requestStatuses.requestId, workspaceRequestIds),
              eq(requestStatuses.workspaceId, workspaceId),
              eq(requestStatuses.statusId, statusId),
              gt(requestStatuses.quantity, 0),
            ),
          )
          .limit(1)
          .get()
        if (used) throw new Error(`workflow status ${statusId} still has copies and cannot be removed`)
        await tx
          .delete(requestStatuses)
          .where(
            and(
              eq(requestStatuses.workspaceId, workspaceId),
              inArray(requestStatuses.requestId, workspaceRequestIds),
              eq(requestStatuses.statusId, statusId),
            ),
          )
          .run()
      }
      const requestIds = await workspaceRequestIds.all()
      const statuses = requestIds.flatMap(({ id }) =>
        workflow.statuses.map((status) => ({ workspaceId, requestId: id, statusId: status.id, quantity: 0 })),
      )
      if (statuses.length) await tx.insert(requestStatuses).values(statuses).onConflictDoNothing().run()
    })
  }

  private async getCompletedUploadFrom(db: DatabaseExecutor, uploadId: string, ownerId: string) {
    return (
      (
        await db
          .select({ id: uploadSessions.completedRequestId })
          .from(uploadSessions)
          .where(
            and(
              eq(uploadSessions.workspaceId, await this.workspace()),
              eq(uploadSessions.id, uploadId),
              eq(uploadSessions.ownerId, ownerId),
            ),
          )
          .get()
      )?.id ?? undefined
    )
  }

  private async getSettingFrom<T>(db: DatabaseExecutor, key: string): Promise<T | undefined> {
    const row = await db
      .select({ value: settings.valueJson })
      .from(settings)
      .where(and(eq(settings.workspaceId, await this.workspace()), eq(settings.key, key)))
      .get()
    return row ? (JSON.parse(row.value) as T) : undefined
  }

  private async setSettingWith(db: DatabaseExecutor, key: string, value: unknown) {
    const values = { workspaceId: await this.workspace(), key, valueJson: JSON.stringify(value), updatedAt: Date.now() }
    await db
      .insert(settings)
      .values(values)
      .onConflictDoUpdate({ target: [settings.workspaceId, settings.key], set: values })
      .run()
  }

  private async setSettingsWith(db: DatabaseExecutor, values: Record<string, unknown>, deleteKeys: string[]) {
    for (const [key, value] of Object.entries(values)) await this.setSettingWith(db, key, value)
    if (deleteKeys.length === 0) return
    await db
      .delete(settings)
      .where(and(eq(settings.workspaceId, await this.workspace()), inArray(settings.key, deleteKeys)))
      .run()
  }

  private async moveCopiesWith(
    db: DatabaseExecutor,
    input: { id: string; from: string; to: string; count: number; filePath: string; order?: number; movedAt?: number },
  ) {
    const workspaceId = await this.workspace()
    const from = await db
      .select({ quantity: requestStatuses.quantity, sortOrder: requestStatuses.sortOrder })
      .from(requestStatuses)
      .where(
        and(
          eq(requestStatuses.workspaceId, workspaceId),
          eq(requestStatuses.requestId, input.id),
          eq(requestStatuses.statusId, input.from),
        ),
      )
      .get()
    if (!from || from.quantity < input.count) throw new Error('invalid move')
    const target = await db
      .select({ quantity: requestStatuses.quantity })
      .from(requestStatuses)
      .where(
        and(eq(requestStatuses.workspaceId, workspaceId), eq(requestStatuses.requestId, input.id), eq(requestStatuses.statusId, input.to)),
      )
      .get()
    if (!target) throw new Error('invalid target status')
    await db
      .update(requestStatuses)
      .set({
        quantity: sql`${requestStatuses.quantity} - ${input.count}`,
        completedAt:
          input.from === 'done'
            ? sql`CASE WHEN ${requestStatuses.quantity} = ${input.count} THEN NULL ELSE ${requestStatuses.completedAt} END`
            : requestStatuses.completedAt,
      })
      .where(
        and(
          eq(requestStatuses.workspaceId, workspaceId),
          eq(requestStatuses.requestId, input.id),
          eq(requestStatuses.statusId, input.from),
        ),
      )
      .run()
    await db
      .update(requestStatuses)
      .set({
        quantity: sql`${requestStatuses.quantity} + ${input.count}`,
        sortOrder: sql`CASE WHEN ${requestStatuses.quantity} = 0 THEN ${from.sortOrder} ELSE ${requestStatuses.sortOrder} END`,
        completedAt: input.to === 'done' ? (input.movedAt ?? Date.now()) : requestStatuses.completedAt,
      })
      .where(
        and(eq(requestStatuses.workspaceId, workspaceId), eq(requestStatuses.requestId, input.id), eq(requestStatuses.statusId, input.to)),
      )
      .run()
    await db
      .update(requests)
      .set({ filePath: input.filePath, updatedAt: Date.now() })
      .where(and(eq(requests.workspaceId, await this.workspace()), eq(requests.id, input.id)))
      .run()
  }
}
