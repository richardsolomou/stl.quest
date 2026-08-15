import type { RequestFacets } from '../core/types'
import type { BoardSearch } from './boardSearch'
import { printTypeLabel } from './fleet'

export const BOARD_METADATA_FILTERS = [
  ['hasNotes', 'Notes'],
  ['hasSource', 'Source link'],
  ['hasThumbnail', 'Thumbnail'],
  ['hasPreview', '3D preview'],
] as const

export function activeBoardFilters(search: BoardSearch, facets: RequestFacets, tagLabel?: string) {
  const requester = facets.requesters.find((option) => option.value === search.requester)
  return [
    search.printType && { key: 'printType', label: printTypeLabel(search.printType) },
    search.requester && { key: 'requester', label: requester?.label ?? search.requester },
    search.tag && { key: 'tag', label: tagLabel ?? search.tag },
    search.minQuantity !== undefined && { key: 'minQuantity', label: `Qty ≥ ${search.minQuantity}` },
    search.maxQuantity !== undefined && { key: 'maxQuantity', label: `Qty ≤ ${search.maxQuantity}` },
    search.maxMaterial !== undefined && { key: 'maxMaterial', label: `Material ≤ ${search.maxMaterial} per copy` },
    search.createdAfter && { key: 'createdAfter', label: `Created after ${search.createdAfter}` },
    search.createdBefore && { key: 'createdBefore', label: `Created before ${search.createdBefore}` },
    search.updatedAfter && { key: 'updatedAfter', label: `Updated after ${search.updatedAfter}` },
    search.updatedBefore && { key: 'updatedBefore', label: `Updated before ${search.updatedBefore}` },
    ...BOARD_METADATA_FILTERS.map(([key, label]) =>
      search[key] === undefined ? undefined : { key, label: `${search[key] ? 'Has' : 'Missing'} ${label.toLowerCase()}` },
    ),
  ].filter(Boolean) as { key: keyof BoardSearch; label: string }[]
}
