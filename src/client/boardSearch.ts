import type { BoardSort, PrintType, RequestFilters, RequestSort } from '../core/types'

export type BoardSearch = {
  q?: string
  requester?: string
  minQuantity?: number
  maxQuantity?: number
  createdAfter?: string
  createdBefore?: string
  updatedAfter?: string
  updatedBefore?: string
  hasNotes?: boolean
  hasSource?: boolean
  hasThumbnail?: boolean
  hasPreview?: boolean
  printType?: PrintType
  printer?: string
  sort?: BoardSort
  next?: string
}

const SORT_IDS = new Set<BoardSort>([
  'fair',
  'round-robin',
  'created-asc',
  'created-desc',
  'quantity-desc',
  'quantity-asc',
  'name-asc',
  'name-desc',
  'updated-desc',
  'updated-asc',
])

function endOfDay(value?: string) {
  if (!value) return undefined
  const date = new Date(`${value}T23:59:59.999`)
  return Number.isNaN(date.valueOf()) ? undefined : date.valueOf()
}

function startOfDay(value?: string) {
  if (!value) return undefined
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.valueOf()) ? undefined : date.valueOf()
}

const text = (value: unknown, max = 200) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined)
const number = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value ? Number(value) : undefined
  return parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined
}
const boolean = (value: unknown) => {
  if (value === true || value === 'true' || value === '1') return true
  if (value === false || value === 'false' || value === '0') return false
  return undefined
}

export function validateRequestSearch(input: Record<string, unknown>): BoardSearch {
  const rawSort = text(input.sort)
  const sort = (rawSort === 'board' ? 'fair' : rawSort) as BoardSort | undefined
  return {
    q: text(input.q),
    requester: text(input.requester, 100),
    minQuantity: number(input.minQuantity),
    maxQuantity: number(input.maxQuantity),
    createdAfter: text(input.createdAfter, 10),
    createdBefore: text(input.createdBefore, 10),
    updatedAfter: text(input.updatedAfter, 10),
    updatedBefore: text(input.updatedBefore, 10),
    hasNotes: boolean(input.hasNotes),
    hasSource: boolean(input.hasSource),
    hasThumbnail: boolean(input.hasThumbnail),
    hasPreview: boolean(input.hasPreview),
    printType: input.printType === 'resin' || input.printType === 'filament' ? input.printType : undefined,
    printer: text(input.printer, 100),
    sort: sort && SORT_IDS.has(sort) ? sort : undefined,
    next: text(input.next, 8_000),
  }
}

export function updateRequestSearch(current: BoardSearch, patch: Partial<BoardSearch>): BoardSearch {
  const next: BoardSearch = { ...current, ...patch }
  for (const key of Object.keys(next) as (keyof BoardSearch)[]) {
    if (next[key] === undefined) delete next[key]
  }
  return next
}

export function filtersFromSearch(search: BoardSearch, defaultSort: RequestSort = 'fair'): RequestFilters {
  return {
    query: search.q,
    requester: search.requester,
    minQuantity: search.minQuantity,
    maxQuantity: search.maxQuantity,
    createdAfter: startOfDay(search.createdAfter),
    createdBefore: endOfDay(search.createdBefore),
    updatedAfter: startOfDay(search.updatedAfter),
    updatedBefore: endOfDay(search.updatedBefore),
    hasNotes: search.hasNotes,
    hasSource: search.hasSource,
    hasThumbnail: search.hasThumbnail,
    hasPreview: search.hasPreview,
    printType: search.printType,
    printerId: search.printer === 'unassigned' ? null : search.printer,
    sort: search.sort === 'round-robin' ? defaultSort : (search.sort ?? defaultSort),
  }
}
