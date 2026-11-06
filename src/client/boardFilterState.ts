import type { Messages } from '../core/i18n'
import type { RequestFacets } from '../core/types'
import type { BoardSearch } from './boardSearch'
import { printTypeLabel } from './fleet'

export const BOARD_METADATA_FILTERS = ['hasNotes', 'hasSource', 'hasThumbnail', 'hasPreview'] as const

export function activeBoardFilters(t: Messages, search: BoardSearch, facets: RequestFacets, tagLabel?: string) {
  const active = t.board.filters.active
  const requester = facets.requesters.find((option) => option.value === search.requester)
  return [
    search.printType && { key: 'printType', label: printTypeLabel(t, search.printType) },
    search.requester && { key: 'requester', label: requester?.label ?? search.requester },
    search.tag && { key: 'tag', label: tagLabel ?? search.tag },
    search.minQuantity !== undefined && { key: 'minQuantity', label: active.minQuantity(search.minQuantity) },
    search.maxQuantity !== undefined && { key: 'maxQuantity', label: active.maxQuantity(search.maxQuantity) },
    search.minMaterial !== undefined && { key: 'minMaterial', label: active.minMaterial(search.minMaterial) },
    search.maxMaterial !== undefined && { key: 'maxMaterial', label: active.maxMaterial(search.maxMaterial) },
    search.createdAfter && { key: 'createdAfter', label: active.createdAfter(search.createdAfter) },
    search.createdBefore && { key: 'createdBefore', label: active.createdBefore(search.createdBefore) },
    search.updatedAfter && { key: 'updatedAfter', label: active.updatedAfter(search.updatedAfter) },
    search.updatedBefore && { key: 'updatedBefore', label: active.updatedBefore(search.updatedBefore) },
    ...BOARD_METADATA_FILTERS.map((key) =>
      search[key] === undefined ? undefined : { key, label: (search[key] ? active.present : active.missing)[key] },
    ),
  ].filter(Boolean) as { key: keyof BoardSearch; label: string }[]
}
