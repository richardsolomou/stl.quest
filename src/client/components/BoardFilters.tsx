import { useCallback, useEffect, useRef, useState } from 'react'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { RequestFacets, RequestFilters, RequestSort } from '../../core/types'
import { DatePicker } from './DatePicker'
import { PeopleCombobox } from './PeopleCombobox'

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
  sort?: RequestSort
}

const SORTS: { value: RequestSort; label: string }[] = [
  { value: 'board', label: 'Board order' },
  { value: 'updated-desc', label: 'Recently updated' },
  { value: 'updated-asc', label: 'Least recently updated' },
  { value: 'created-desc', label: 'Newest created' },
  { value: 'created-asc', label: 'Oldest created' },
  { value: 'name-asc', label: 'Name A–Z' },
  { value: 'name-desc', label: 'Name Z–A' },
  { value: 'quantity-desc', label: 'Highest quantity' },
  { value: 'quantity-asc', label: 'Lowest quantity' },
]

const SORT_IDS = new Set(SORTS.map((sort) => sort.value))

const AVAILABILITY = [
  { value: '', label: 'Any' },
  { value: 'yes', label: 'Available' },
  { value: 'no', label: 'Missing' },
] as const

const METADATA = [
  ['hasNotes', 'Notes'],
  ['hasSource', 'Source link'],
  ['hasThumbnail', 'Thumbnail'],
  ['hasPreview', '3D preview'],
] as const

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
  const sort = text(input.sort) as RequestSort | undefined
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
    sort: sort && SORT_IDS.has(sort) ? sort : undefined,
  }
}

export function updateRequestSearch(current: BoardSearch, patch: Partial<BoardSearch>): BoardSearch {
  const next: BoardSearch = { ...current, ...patch }
  for (const key of Object.keys(next) as (keyof BoardSearch)[]) {
    if (next[key] === undefined) delete next[key]
  }
  return next
}

export function filtersFromSearch(search: BoardSearch, defaultSort: RequestSort = 'board'): RequestFilters {
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
    sort: search.sort ?? defaultSort,
  }
}

export function BoardFilters({
  search,
  facets,
  isFetching,
  onChange,
  defaultSort = 'board',
  ariaLabel = 'Board filters',
  description = 'Combine any fields to narrow the board.',
  className,
}: {
  search: BoardSearch
  facets: RequestFacets
  isFetching: boolean
  onChange: (patch: Partial<BoardSearch>, replace?: boolean) => void
  defaultSort?: RequestSort
  ariaLabel?: string
  description?: string
  className?: string
}) {
  const queryTimer = useRef<number | undefined>(undefined)
  const [hydrated, setHydrated] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState(search.q ?? '')

  useEffect(() => setQuery(search.q ?? ''), [search.q])
  useEffect(() => setHydrated(true), [])
  useEffect(() => () => window.clearTimeout(queryTimer.current), [])

  const advanced = [
    search.requester,
    search.minQuantity,
    search.maxQuantity,
    search.createdAfter,
    search.createdBefore,
    search.updatedAfter,
    search.updatedBefore,
    search.hasNotes,
    search.hasNotes === false,
    search.hasSource,
    search.hasSource === false,
    search.hasThumbnail,
    search.hasThumbnail === false,
    search.hasPreview,
    search.hasPreview === false,
  ].filter(Boolean).length

  const active = [
    search.requester && { key: 'requester', label: search.requester },
    search.minQuantity !== undefined && { key: 'minQuantity', label: `Qty ≥ ${search.minQuantity}` },
    search.maxQuantity !== undefined && { key: 'maxQuantity', label: `Qty ≤ ${search.maxQuantity}` },
    search.createdAfter && { key: 'createdAfter', label: `Created after ${search.createdAfter}` },
    search.createdBefore && { key: 'createdBefore', label: `Created before ${search.createdBefore}` },
    search.updatedAfter && { key: 'updatedAfter', label: `Updated after ${search.updatedAfter}` },
    search.updatedBefore && { key: 'updatedBefore', label: `Updated before ${search.updatedBefore}` },
    ...METADATA.map(([key, label]) =>
      search[key] === undefined ? undefined : { key, label: `${search[key] ? 'Has' : 'Missing'} ${label.toLowerCase()}` },
    ),
  ].filter(Boolean) as { key: keyof BoardSearch; label: string }[]

  const updateQuery = useCallback(
    (value: string) => {
      setQuery(value)
      window.clearTimeout(queryTimer.current)
      queryTimer.current = window.setTimeout(() => onChange({ q: value.trim() || undefined }, true), 350)
    },
    [onChange],
  )
  const clearQuery = useCallback(() => {
    window.clearTimeout(queryTimer.current)
    setQuery('')
    onChange({ q: undefined }, true)
  }, [onChange])
  const clear = () => {
    window.clearTimeout(queryTimer.current)
    setQuery('')
    onChange({
      q: undefined,
      requester: undefined,
      minQuantity: undefined,
      maxQuantity: undefined,
      createdAfter: undefined,
      createdBefore: undefined,
      updatedAfter: undefined,
      updatedBefore: undefined,
      hasNotes: undefined,
      hasSource: undefined,
      hasThumbnail: undefined,
      hasPreview: undefined,
      sort: undefined,
    })
  }

  return (
    <section className={cn('relative z-5 bg-background px-5 pt-2.5', className)} aria-label={ariaLabel} data-hydrated={hydrated}>
      <div className="flex min-h-9.5 items-center gap-2 max-[900px]:flex-wrap">
        <InputGroup className="w-[clamp(190px,24vw,340px)] bg-card max-[900px]:w-full">
          <InputGroupAddon>
            <Search aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search requests"
            value={query}
            onChange={(event) => updateQuery(event.target.value)}
            placeholder="Search prints…"
          />
          {query && (
            <InputGroupAddon align="inline-end">
              <Tooltip>
                <TooltipTrigger render={<InputGroupButton size="icon-xs" aria-label="Clear search" onClick={clearQuery} />}>
                  <X />
                </TooltipTrigger>
                <TooltipContent>Clear search</TooltipContent>
              </Tooltip>
            </InputGroupAddon>
          )}
        </InputGroup>

        <div className="flex-1 max-[900px]:hidden" />
        <span className="inline-flex items-center gap-1.5 font-mono text-xs whitespace-nowrap text-muted-foreground" aria-live="polite">
          {isFetching && <Spinner className="size-3 text-primary" aria-label="Refreshing board" />}
          {facets.total === facets.available ? facets.total : `${facets.total} / ${facets.available}`}
        </span>
        <Select
          items={SORTS}
          value={search.sort ?? defaultSort}
          onValueChange={(value) => onChange({ sort: value === defaultSort ? undefined : (value as RequestSort) })}
        >
          <SelectTrigger className="min-w-40" aria-label="Sort requests">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((sort) => (
              <SelectItem key={sort.value} value={sort.value}>
                {sort.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Popover open={expanded} onOpenChange={setExpanded}>
          <PopoverTrigger render={<Button type="button" variant={advanced > 0 ? 'outline' : 'ghost'} />}>
            <SlidersHorizontal />
            Filters
            {advanced > 0 && (
              <span className="rounded-full bg-primary px-1.5 font-mono text-[10px] text-primary-foreground">{advanced}</span>
            )}
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={8} className="w-[min(680px,calc(100vw-40px))] gap-0 p-0">
            <header className="flex items-start justify-between border-b p-4">
              <PopoverHeader>
                <PopoverTitle>More filters</PopoverTitle>
                <PopoverDescription>{description}</PopoverDescription>
              </PopoverHeader>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button type="button" variant="ghost" size="icon-sm" aria-label="Close filters" onClick={() => setExpanded(false)} />
                  }
                >
                  <X />
                </TooltipTrigger>
                <TooltipContent>Close filters</TooltipContent>
              </Tooltip>
            </header>
            <div className="grid grid-cols-2 gap-4 p-4 max-[900px]:grid-cols-1">
              <section className="grid content-start gap-2">
                <h3 className="font-heading text-xs font-semibold tracking-wide uppercase text-muted-foreground">Requester</h3>
                <PeopleCombobox
                  value={search.requester}
                  onChange={(requester) => onChange({ requester })}
                  placeholder="Anyone"
                  options={facets.requesters.map((requester) => ({
                    value: requester.value,
                    label: `${requester.label} · ${requester.count}`,
                  }))}
                />
              </section>
              <section className="grid content-start gap-2">
                <h3 className="font-heading text-xs font-semibold tracking-wide uppercase text-muted-foreground">Quantity</h3>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    aria-label="Minimum quantity"
                    type="number"
                    min="1"
                    max="50"
                    placeholder="Minimum"
                    value={search.minQuantity ?? ''}
                    onChange={(event) => onChange({ minQuantity: event.target.value ? Number(event.target.value) : undefined })}
                  />
                  <Input
                    aria-label="Maximum quantity"
                    type="number"
                    min="1"
                    max="50"
                    placeholder="Maximum"
                    value={search.maxQuantity ?? ''}
                    onChange={(event) => onChange({ maxQuantity: event.target.value ? Number(event.target.value) : undefined })}
                  />
                </div>
              </section>
              <section className="grid content-start gap-2">
                <h3 className="font-heading text-xs font-semibold tracking-wide uppercase text-muted-foreground">Created</h3>
                <div className="grid grid-cols-2 gap-2">
                  <DatePicker label="After" value={search.createdAfter} onChange={(createdAfter) => onChange({ createdAfter })} />
                  <DatePicker label="Before" value={search.createdBefore} onChange={(createdBefore) => onChange({ createdBefore })} />
                </div>
              </section>
              <section className="grid content-start gap-2">
                <h3 className="font-heading text-xs font-semibold tracking-wide uppercase text-muted-foreground">Last updated</h3>
                <div className="grid grid-cols-2 gap-2">
                  <DatePicker label="After" value={search.updatedAfter} onChange={(updatedAfter) => onChange({ updatedAfter })} />
                  <DatePicker label="Before" value={search.updatedBefore} onChange={(updatedBefore) => onChange({ updatedBefore })} />
                </div>
              </section>
              <section className="col-span-2 grid grid-cols-4 gap-2 max-[900px]:col-span-1 max-[900px]:grid-cols-2">
                <h3 className="col-span-full font-heading text-xs font-semibold tracking-wide uppercase text-muted-foreground">Metadata</h3>
                {METADATA.map(([key, label]) => (
                  <label className="grid gap-1 text-xs text-muted-foreground" key={key}>
                    <span>{label}</span>
                    <Select
                      items={AVAILABILITY}
                      value={search[key] === undefined ? '' : search[key] ? 'yes' : 'no'}
                      onValueChange={(value) => onChange({ [key]: value === '' ? undefined : value === 'yes' })}
                    >
                      <SelectTrigger className="w-full" aria-label={`${label} availability`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {AVAILABILITY.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                ))}
              </section>
            </div>
            <footer className="flex justify-end gap-2 border-t bg-muted/30 p-3">
              <Button type="button" variant="ghost" size="sm" onClick={clear}>
                Reset all filters
              </Button>
              <Button type="button" size="sm" onClick={() => setExpanded(false)}>
                Done
              </Button>
            </footer>
          </PopoverContent>
        </Popover>
      </div>

      {active.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {active.map((filter) => (
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="shrink-0"
              key={`${filter.key}-${filter.label}`}
              onClick={() => onChange({ [filter.key]: undefined })}
            >
              {filter.label}
              <X aria-hidden="true" />
            </Button>
          ))}
          <Button type="button" variant="ghost" size="xs" onClick={clear}>
            Clear all
          </Button>
        </div>
      )}
    </section>
  )
}
