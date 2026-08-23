import { and, asc, desc, eq, getTableColumns, gte, inArray, isNotNull, isNull, lte, or, sql, type SQL } from 'drizzle-orm'
import type { PrinterProfile, RequestFilters, RequestQuery } from '../../core/types'
import { requests, requestStatuses, user } from '../schema'

export type RequestFilterOptions = { omitRequester?: boolean; includeOwner?: boolean }

export const requestSelection = {
  ...getTableColumns(requests),
  ownerEmail: user.email,
  ownerName: user.name,
}

const ORDER_BY: Record<NonNullable<RequestFilters['sort']>, SQL[]> = {
  fair: [desc(requests.createdAt)],
  'updated-desc': [desc(requests.updatedAt), desc(requests.createdAt)],
  'updated-asc': [asc(requests.updatedAt), asc(requests.createdAt)],
  'created-desc': [desc(requests.createdAt)],
  'created-asc': [asc(requests.createdAt)],
  'name-asc': [sql`lower(${requests.name}) ASC`, desc(requests.createdAt)],
  'name-desc': [sql`lower(${requests.name}) DESC`, desc(requests.createdAt)],
  'quantity-desc': [desc(requests.quantity), desc(requests.createdAt)],
  'quantity-asc': [asc(requests.quantity), desc(requests.createdAt)],
  'material-desc': [desc(requests.createdAt)],
  'material-asc': [desc(requests.createdAt)],
  'time-desc': [desc(requests.createdAt)],
  'time-asc': [desc(requests.createdAt)],
  'archived-desc': [desc(requests.archivedAt), desc(requests.createdAt)],
  'archived-asc': [asc(requests.archivedAt), asc(requests.createdAt)],
}

export function requestOrderBy(sort: RequestFilters['sort']) {
  return ORDER_BY[sort ?? 'fair']
}

export function requestConditions(
  workspaceId: string,
  filters: RequestFilters,
  query: RequestQuery,
  printerProfiles: PrinterProfile[],
  options: RequestFilterOptions = {},
) {
  const conditions: SQL[] = [eq(requests.workspaceId, workspaceId), archivedCondition(filters, query)]

  if (query.visibleToUserId) conditions.push(eq(requests.ownerUserId, query.visibleToUserId))
  if (options.includeOwner !== false && query.ownerUserId) conditions.push(eq(requests.ownerUserId, query.ownerUserId))
  if (filters.query) {
    const pattern = `%${escapeLike(filters.query.toLowerCase())}%`
    const privateMetadata = query.searchPrivateMetadata ? sql` || ' ' || ${requests.fileName} || ' ' || ${user.email}` : sql``
    conditions.push(
      sql`(lower(${requests.id} || ' ' || ${requests.name}${privateMetadata} || ' ' ||
        ${user.name} || ' ' || coalesce(${requests.notes},'') || ' ' || coalesce(${requests.sourceUrl},'')) LIKE ${pattern} ESCAPE ${'\\'}
        OR EXISTS (SELECT 1 FROM ${requestStatuses} search_status
          WHERE search_status.workspace_id = ${requests.workspaceId} AND search_status.request_id = ${requests.id} AND search_status.quantity > 0
            AND lower(replace(search_status.status_id, '_', ' ')) LIKE ${pattern} ESCAPE ${'\\'}))`,
    )
  }
  if (filters.requester && !options.omitRequester) conditions.push(eq(requests.ownerUserId, filters.requester))
  if (filters.minQuantity !== undefined) conditions.push(gte(requests.quantity, filters.minQuantity))
  if (filters.maxQuantity !== undefined) conditions.push(lte(requests.quantity, filters.maxQuantity))
  if (filters.createdAfter !== undefined) conditions.push(gte(requests.createdAt, filters.createdAfter))
  if (filters.createdBefore !== undefined) conditions.push(lte(requests.createdAt, filters.createdBefore))
  if (filters.updatedAfter !== undefined) conditions.push(gte(requests.updatedAt, filters.updatedAfter))
  if (filters.updatedBefore !== undefined) conditions.push(lte(requests.updatedAt, filters.updatedBefore))
  if (filters.hasNotes !== undefined)
    conditions.push(filters.hasNotes ? sql`trim(coalesce(${requests.notes},'')) <> ''` : sql`trim(coalesce(${requests.notes},'')) = ''`)
  if (filters.hasSource !== undefined)
    conditions.push(
      filters.hasSource ? sql`trim(coalesce(${requests.sourceUrl},'')) <> ''` : sql`trim(coalesce(${requests.sourceUrl},'')) = ''`,
    )
  if (filters.hasThumbnail !== undefined)
    conditions.push(filters.hasThumbnail ? isNotNull(requests.thumbnailPath) : isNull(requests.thumbnailPath))
  if (filters.hasPreview !== undefined) conditions.push(filters.hasPreview ? isNotNull(requests.previewPath) : isNull(requests.previewPath))
  if (filters.printType !== undefined) {
    const printerIds = printerProfiles.filter((profile) => printerPrintType(profile) === filters.printType).map((profile) => profile.id)
    conditions.push(
      printerIds.length
        ? or(eq(requests.printType, filters.printType), inArray(requests.printerId, printerIds))!
        : eq(requests.printType, filters.printType),
    )
  }
  if (filters.printerId !== undefined) {
    conditions.push(filters.printerId === null ? isNull(requests.printerId) : eq(requests.printerId, filters.printerId))
  }
  return and(...conditions)
}

function escapeLike(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

function archivedCondition(filters: RequestFilters, query: RequestQuery): SQL {
  if (query.includeArchived) {
    return filters.archived === true ? isNotNull(requests.archivedAt) : sql`true`
  }
  if (filters.archived === true) return isNotNull(requests.archivedAt)
  return isNull(requests.archivedAt)
}

function printerPrintType(printer: PrinterProfile) {
  return printer.printType
}
