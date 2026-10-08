import type { PublicPrintRequest } from '../core/types'
import type { StatusId } from '../core/workflow'
import { boardRequestCohorts } from './boardEntries'

export type BoardSelection = {
  statuses: Map<string, StatusId>
  groupIds: Map<string, string>
  requestIds: Map<string, string>
  anchorId: string
  anchorStatus: StatusId
  anchorGroupId?: string
}
/** Copies of one print in one stage that carry exactly `tagIds`, as drawn by one board card. */
export type BoardCohort = { key: string; count: number; tagIds: string[] }
export type BoardSelectionEntry = {
  request: PublicPrintRequest
  status: StatusId
  groupId?: string
  ungrouped?: true
  cohorts: BoardCohort[]
  max: number
}
type BoardCopiesEntry = Pick<BoardSelectionEntry, 'request' | 'status' | 'groupId' | 'ungrouped' | 'max'>

export function boardCohortId(requestId: string, status: StatusId, groupId?: string) {
  return `${requestId}:${status}:${groupId ?? 'untagged'}`
}

/** Selects every copy of a print in a stage, unlike `boardCohortId(requestId, status)`, which is only its untagged card. */
function boardColumnCohortId(requestId: string, status: StatusId) {
  return `${requestId}:${status}:*`
}

export function boardSelectedCopies(entries: BoardCopiesEntry[], counts: Record<string, number> = {}) {
  return entries.map(({ request, status, groupId, ungrouped, max }) => ({
    request,
    status,
    groupId,
    ungrouped,
    count: counts[request.id] ?? max,
  }))
}

export function boardSelectedRequests(entries: BoardCopiesEntry[]) {
  return [...new Map(entries.map(({ request }) => [request.id, request])).values()]
}

export function boardSelectedRequestIds(selection: BoardSelection | null, status?: StatusId) {
  return new Set(
    [...(selection?.statuses ?? [])]
      .filter(([, selectedStatus]) => status === undefined || selectedStatus === status)
      .filter(([selectionId]) => !selection?.groupIds.has(selectionId))
      .map(([selectionId]) => selection!.requestIds.get(selectionId)!),
  )
}

export function boardSelectedCardIds(selection: BoardSelection | null, status?: StatusId) {
  return new Set(
    [...(selection?.statuses ?? [])]
      .filter(([, selectedStatus]) => status === undefined || selectedStatus === status)
      .map(([selectionId]) => selectionId),
  )
}

export function boardRequestSelected(
  selection: BoardSelection | null,
  status: StatusId,
  requestId: string,
  groupId?: string,
  cohortId?: string,
) {
  const selectionId = cohortId ?? boardCohortId(requestId, status, groupId)
  return selection?.statuses.get(selectionId) === status && selection.groupIds.get(selectionId) === groupId
}

export function boardCardSelection(
  selection: BoardSelection | null,
  status: StatusId,
  requestId: string,
  cohortId: string,
  groupIds: string[],
): { selected: boolean; groupId?: string } {
  if (!selection) return { selected: false }
  const candidates = [
    cohortId,
    ...groupIds.map((groupId) => boardCohortId(requestId, status, groupId)),
    boardColumnCohortId(requestId, status),
  ]
  const selectionId = candidates.find((id) => selection.statuses.get(id) === status)
  if (!selectionId) return { selected: false }
  return { selected: true, groupId: selection.groupIds.get(selectionId) }
}

export function boardBatchMoves(entries: BoardCopiesEntry[], to: StatusId, counts: Record<string, number>) {
  return boardSelectedCopies(entries, counts).map(({ request, status: from, count }) => ({ id: request.id, from, to, count }))
}

export function boardBatchDeletions(entries: BoardCopiesEntry[]) {
  return boardSelectedCopies(entries).map(({ request, status, groupId, ungrouped, count }) => ({
    id: request.id,
    status,
    count,
    ...(groupId ? { groupId } : {}),
    ...(ungrouped ? { ungrouped } : {}),
  }))
}

/** Selected cards can overlap, such as a tag's cards and one card carrying that tag, so each print and stage counts each card once. */
function boardSelectedCohorts(entries: BoardSelectionEntry[]) {
  const stages = new Map<string, { request: PublicPrintRequest; status: StatusId; cohorts: Map<string, BoardCohort> }>()
  for (const { request, status, cohorts } of entries) {
    const key = `${request.id}:${status}`
    const stage = stages.get(key) ?? { request, status, cohorts: new Map() }
    for (const cohort of cohorts) stage.cohorts.set(cohort.key, cohort)
    stages.set(key, stage)
  }
  return [...stages.values()].map(({ request, status, cohorts }) => ({ request, status, cohorts: [...cohorts.values()] }))
}

/** Copies of each print and stage that a tag edit applies to: adding skips copies that carry the tag, removing takes only those. */
export function boardTagItems(entries: BoardSelectionEntry[], edit?: { tagId: string; selected: boolean }) {
  return boardSelectedCohorts(entries)
    .map(({ request, status, cohorts }) => ({
      requestId: request.id,
      status,
      count: Math.min(
        cohorts.filter(({ tagIds }) => !edit || tagIds.includes(edit.tagId) !== edit.selected).reduce((sum, { count }) => sum + count, 0),
        request.counts[status] ?? 0,
      ),
    }))
    .filter(({ count }) => count > 0)
}

/** Tags on every selected copy, and tags on only some of them. */
export function boardSelectionTagState(entries: BoardSelectionEntry[]) {
  const cohorts = boardSelectedCohorts(entries).flatMap((stage) => stage.cohorts)
  const tagIds = new Set(cohorts.flatMap((cohort) => cohort.tagIds))
  const all = new Set([...tagIds].filter((tagId) => cohorts.every((cohort) => cohort.tagIds.includes(tagId))))
  return { all, some: new Set([...tagIds].filter((tagId) => !all.has(tagId))) }
}

/** Applies a tag edit to the copies it was made on, so the picker reflects it without waiting for the board to refresh. */
export function boardEditSelectionTags(entries: BoardSelectionEntry[], tagId: string, selected: boolean): BoardSelectionEntry[] {
  return entries.map((entry) => ({
    ...entry,
    cohorts: entry.cohorts.map((cohort) => ({
      ...cohort,
      tagIds: selected ? [...new Set([...cohort.tagIds, tagId])] : cohort.tagIds.filter((id) => id !== tagId),
    })),
  }))
}

export function boardSelectionEntries(
  requests: PublicPrintRequest[],
  selection: BoardSelection | null,
  countsOf: (request: PublicPrintRequest) => PublicPrintRequest['counts'],
  groupsOf: (request: PublicPrintRequest) => PublicPrintRequest['groups'],
): BoardSelectionEntry[] {
  if (!selection) return []
  return [...selection.statuses].flatMap(([selectionId, status]) => {
    const request = requests.find((candidate) => candidate.id === selection.requestIds.get(selectionId))
    if (!request) return []
    const groupId = selection.groupIds.get(selectionId)
    const cards = boardRequestCohorts({ ...request, groups: groupsOf(request) }, status, countsOf(request)[status])
    const column = selectionId === boardColumnCohortId(request.id, status)
    const selected = groupId
      ? cards.filter((card) => card.request.groups.some((group) => group.id === groupId))
      : cards.filter((card) => column || card.key === selectionId)
    const max = selected.reduce((sum, { count }) => sum + count, 0)
    if (max <= 0) return []
    const cohorts = selected.map(({ key, count, request: cohort }) => ({ key, count, tagIds: cohort.groups.map((group) => group.id) }))
    return [
      {
        request,
        status,
        ...(groupId ? { groupId } : {}),
        ...(!groupId && !column && selected[0].ungrouped ? { ungrouped: true as const } : {}),
        cohorts,
        max,
      },
    ]
  })
}

export function selectBoardTag(requests: PublicPrintRequest[], status: StatusId, tagId: string): BoardSelection | null {
  const entries = requests
    .filter((request) => request.groups.some((group) => group.id === tagId && group.status === status))
    .map((request) => ({ requestId: request.id, selectionId: boardCohortId(request.id, status, tagId) }))
  if (entries.length === 0) return null
  return {
    statuses: new Map(entries.map(({ selectionId }) => [selectionId, status])),
    groupIds: new Map(entries.map(({ selectionId }) => [selectionId, tagId])),
    requestIds: new Map(entries.map(({ selectionId, requestId }) => [selectionId, requestId])),
    anchorId: entries[0].selectionId,
    anchorStatus: status,
    anchorGroupId: tagId,
  }
}

export function selectBoardColumn(requestIds: string[], status: StatusId): BoardSelection | null {
  const entries = [...new Set(requestIds)].map((requestId) => ({ requestId, selectionId: boardColumnCohortId(requestId, status) }))
  if (entries.length === 0) return null
  return {
    statuses: new Map(entries.map(({ selectionId }) => [selectionId, status])),
    groupIds: new Map(),
    requestIds: new Map(entries.map(({ selectionId, requestId }) => [selectionId, requestId])),
    anchorId: entries[0].selectionId,
    anchorStatus: status,
  }
}

export function selectBoardRequest(
  selection: BoardSelection | null,
  status: StatusId,
  orderedIds: string[],
  requestId: string,
  options: { range?: boolean; toggle?: boolean } = {},
  groupId?: string,
  cohortId?: string,
): BoardSelection | null {
  const selectionId = cohortId ?? boardCohortId(requestId, status, groupId)
  const orderedSelectionIds = orderedIds.map((id) => boardCohortId(id, status, groupId))
  if (options.range && selection?.anchorStatus === status && selection.anchorGroupId === groupId) {
    const anchor = orderedSelectionIds.indexOf(selection.anchorId)
    const target = orderedSelectionIds.indexOf(selectionId)
    if (anchor < 0 || target < 0) return selection
    const [start, end] = anchor < target ? [anchor, target] : [target, anchor]
    const range = new Set(orderedSelectionIds.slice(start, end + 1))
    const statuses = new Map(selection.statuses)
    const groupIds = new Map(selection.groupIds)
    const requestIds = new Map(selection.requestIds)
    for (const [index, id] of orderedSelectionIds.entries()) {
      if (statuses.get(id) === status && groupIds.get(id) === groupId) {
        statuses.delete(id)
        groupIds.delete(id)
        requestIds.delete(id)
      }
      if (range.has(id)) {
        statuses.set(id, status)
        requestIds.set(id, orderedIds[index])
        if (groupId) groupIds.set(id, groupId)
      }
    }
    return { ...selection, statuses, groupIds, requestIds }
  }
  if (options.toggle) {
    const statuses = new Map(selection?.statuses)
    const groupIds = new Map(selection?.groupIds)
    const requestIds = new Map(selection?.requestIds)
    if (statuses.get(selectionId) === status && groupIds.get(selectionId) === groupId) {
      statuses.delete(selectionId)
      groupIds.delete(selectionId)
      requestIds.delete(selectionId)
    } else {
      statuses.set(selectionId, status)
      requestIds.set(selectionId, requestId)
      if (groupId) groupIds.set(selectionId, groupId)
      else groupIds.delete(selectionId)
    }
    return statuses.size ? { statuses, groupIds, requestIds, anchorId: selectionId, anchorStatus: status, anchorGroupId: groupId } : null
  }
  return {
    statuses: new Map([[selectionId, status]]),
    groupIds: groupId ? new Map([[selectionId, groupId]]) : new Map(),
    requestIds: new Map([[selectionId, requestId]]),
    anchorId: selectionId,
    anchorStatus: status,
    anchorGroupId: groupId,
  }
}
