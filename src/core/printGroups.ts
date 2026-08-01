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

/**
 * Reads a typed path such as `Build plates / Plate 14` as a new leaf name plus the parent it belongs
 * under, so nesting can be expressed in the same notation the rest of the UI displays.
 */
export function parsePrintGroupPath(input: string, rows: PrintGroupRow<PrintGroupNode>[]) {
  const segments = input.split('/').map((segment) => segment.trim())
  const name = segments.pop() ?? ''
  const parentPath = segments.join(PRINT_GROUP_PATH_SEPARATOR)
  const parent = parentPath ? rows.find((row) => equalPaths(row.path, parentPath)) : undefined
  const path = parent ? `${parent.path}${PRINT_GROUP_PATH_SEPARATOR}${name}` : name
  return {
    name,
    parent,
    path,
    creatable: validPrintGroupName(name) && (!parentPath || parent !== undefined) && !rows.some((row) => equalPaths(row.path, path)),
  }
}

function equalPaths(left: string, right: string) {
  return left.toLocaleLowerCase() === right.toLocaleLowerCase()
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
