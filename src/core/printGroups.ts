import type { PrintGroup } from './types'

export const MAX_PRINT_GROUP_NAME_LENGTH = 80
export const PRINT_GROUP_PATH_SEPARATOR = ' / '

export function validPrintGroupName(name: string) {
  const normalized = name.trim()
  return normalized.length > 0 && normalized.length <= MAX_PRINT_GROUP_NAME_LENGTH
}

export type PrintGroupNode = Pick<PrintGroup, 'id' | 'name' | 'parentId'>
export type PrintGroupRow<T extends PrintGroupNode = PrintGroup> = { group: T; depth: number; path: string }

/**
 * Depth-first rows with siblings in alphabetical order. Groups whose parent is missing or part of a
 * cycle surface as roots so unexpected data stays visible and editable rather than disappearing.
 */
export function printGroupRows<T extends PrintGroupNode>(groups: T[]): PrintGroupRow<T>[] {
  const byId = new Map(groups.map((group) => [group.id, group]))
  const children = new Map<string | undefined, T[]>()
  for (const group of groups) {
    const parentId = group.parentId && byId.has(group.parentId) ? group.parentId : undefined
    const siblings = children.get(parentId)
    if (siblings) siblings.push(group)
    else children.set(parentId, [group])
  }
  for (const siblings of children.values()) siblings.sort((left, right) => left.name.localeCompare(right.name))

  const rows: PrintGroupRow<T>[] = []
  const walked = new Set<string>()
  const walk = (group: T, depth: number, prefix: string) => {
    if (walked.has(group.id)) return
    walked.add(group.id)
    const path = prefix ? `${prefix}${PRINT_GROUP_PATH_SEPARATOR}${group.name}` : group.name
    rows.push({ group, depth, path })
    for (const child of children.get(group.id) ?? []) walk(child, depth + 1, path)
  }
  for (const root of children.get(undefined) ?? []) walk(root, 0, '')
  for (const group of groups) walk(group, 0, '')
  return rows
}

export function printGroupPaths(groups: PrintGroupNode[]) {
  return new Map(printGroupRows(groups).map((row) => [row.group.id, row.path]))
}

const printGroupNameKey = (name: string) => name.trim().toLocaleLowerCase()

/** Whether another of these tags already uses the name, ignoring case and surrounding whitespace. */
export function printGroupNameTaken(groups: PrintGroupNode[], name: string, exceptId?: string) {
  const key = printGroupNameKey(name)
  return groups.some((group) => group.id !== exceptId && printGroupNameKey(group.name) === key)
}

/** The group itself plus everything nested below it, which is what a filter or a reparent guard needs. */
export function printGroupBranchIds(groups: PrintGroupNode[], id: string) {
  const rows = printGroupRows(groups)
  const start = rows.findIndex((row) => row.group.id === id)
  if (start < 0) return new Set([id])
  const branch = new Set([id])
  for (let index = start + 1; index < rows.length && rows[index].depth > rows[start].depth; index += 1) {
    branch.add(rows[index].group.id)
  }
  return branch
}

export type PrintGroupCohort<T> = { count: number; tags: T[] }

/**
 * Copies have no identity: a print's copies in one stage are a count plus a copy count per tag. This splits them
 * into cohorts of copies that carry exactly the same tags, giving each tag, in order, to the copies with the fewest
 * tags first, so tags only overlap when they must. The board draws one card per cohort, and deleting a card takes
 * its copies out of that cohort.
 */
export function printGroupCohorts<T extends { id: string; count: number }>(count: number, tags: T[]): PrintGroupCohort<T>[] {
  const cohorts: PrintGroupCohort<T>[] = count > 0 ? [{ count, tags: [] }] : []
  for (const tag of tags) {
    let remaining = Math.min(tag.count, count)
    const withoutTag = cohorts.filter((cohort) => !cohort.tags.some((candidate) => candidate.id === tag.id))
    withoutTag.sort((left, right) => left.tags.length - right.tags.length)
    for (const cohort of withoutTag) {
      if (remaining === 0) break
      const assigned = Math.min(remaining, cohort.count)
      remaining -= assigned
      if (assigned === cohort.count) cohort.tags = [...cohort.tags, tag]
      else {
        cohort.count -= assigned
        cohorts.push({ count: assigned, tags: [...cohort.tags, tag] })
      }
    }
  }
  return cohorts.filter((cohort) => cohort.count > 0)
}

/** Identifies a cohort by its tags regardless of their order. */
export function printGroupCohortKey(tagIds: string[]) {
  return [...tagIds].sort().join(',')
}

/**
 * Plans taking copies out of a stage's cohorts. A take naming `tagIds` takes copies of the cohort carrying exactly
 * those tags (none for an empty list); a take without `tagIds` takes copies of any cohort, those with the fewest tags
 * first. Returns, for each take, how many copies it takes from each tag, or `undefined` when the stage lacks them.
 */
export function printGroupCohortTakes<T extends { id: string; count: number }>(
  count: number,
  tags: T[],
  takes: { count: number; tagIds?: string[] }[],
): Map<string, number>[] | undefined {
  const cohorts = printGroupCohorts(count, tags).map((cohort) => ({
    count: cohort.count,
    tagIds: cohort.tags.map(({ id }) => id),
  }))
  const removed = takes.map(() => new Map<string, number>())
  const take = (index: number, cohort: (typeof cohorts)[number], copies: number) => {
    cohort.count -= copies
    for (const tagId of cohort.tagIds) removed[index].set(tagId, (removed[index].get(tagId) ?? 0) + copies)
  }
  for (const [index, { count: copies, tagIds }] of takes.entries()) {
    if (!tagIds) continue
    const cohort = cohorts.find((candidate) => printGroupCohortKey(candidate.tagIds) === printGroupCohortKey(tagIds))
    if (!cohort || cohort.count < copies) return undefined
    take(index, cohort, copies)
  }
  const fewestTagsFirst = [...cohorts].sort((left, right) => left.tagIds.length - right.tagIds.length)
  for (const [index, { count: copies, tagIds }] of takes.entries()) {
    if (tagIds) continue
    let remaining = copies
    for (const cohort of fewestTagsFirst) {
      const taken = Math.min(remaining, cohort.count)
      if (taken > 0) take(index, cohort, taken)
      remaining -= taken
    }
    if (remaining > 0) return undefined
  }
  return removed
}
