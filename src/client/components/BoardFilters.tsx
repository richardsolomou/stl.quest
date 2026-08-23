import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpDown, Check, Search, SlidersHorizontal, Tags, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Menu, MenuContent, MenuGroup, MenuGroupLabel, MenuRadioGroup, MenuRadioItem, MenuTrigger } from '@/components/ui/menu'
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'
import type { BoardSort, PrintGroup, PrintType, RequestFacets } from '../../core/types'
import { MAX_REQUEST_QUANTITY, MIN_REQUEST_QUANTITY } from '../../core/request'
import { DatePicker } from './DatePicker'
import { FilterCombobox } from './FilterCombobox'
import { TagTreeRow } from './TagBadge'
import type { BoardSearch } from '../boardSearch'
import { activeBoardFilters, BOARD_METADATA_FILTERS } from '../boardFilterState'
import { availablePrintTypes, printTypeLabel } from '../fleet'
import { signalProductTourProgress } from '../productTour'
import { printGroupRows } from '../../core/printGroups'

export type SortGroup = { label: string; options: { value: BoardSort; label: string; description: string }[] }

export const DEFAULT_SORT_GROUPS: SortGroup[] = [
  {
    label: 'Queue strategy',
    options: [
      {
        value: 'fair',
        label: 'Requester priorities',
        description: "Group requests by requester and preserve each person's chosen order.",
      },
      {
        value: 'round-robin',
        label: 'Round robin',
        description: "Take each requester's highest-priority print in turn.",
      },
    ],
  },
  {
    label: 'Submission time',
    options: [
      { value: 'created-asc', label: 'Oldest first', description: 'Start with requests submitted earliest.' },
      { value: 'created-desc', label: 'Newest first', description: 'Start with the most recently submitted requests.' },
    ],
  },
  {
    label: 'Request details',
    options: [
      { value: 'name-asc', label: 'Name A–Z', description: 'Sort alphabetically by request name.' },
      { value: 'name-desc', label: 'Name Z–A', description: 'Sort reverse-alphabetically by request name.' },
      { value: 'updated-desc', label: 'Recently updated', description: 'Show requests changed most recently first.' },
      { value: 'updated-asc', label: 'Least recently updated', description: 'Show requests waiting longest without changes first.' },
      { value: 'material-asc', label: 'Least material', description: 'Start with requests using the least material per copy.' },
      { value: 'material-desc', label: 'Most material', description: 'Start with requests using the most material per copy.' },
      { value: 'time-asc', label: 'Shortest print', description: 'Start with requests estimated to finish fastest.' },
      { value: 'time-desc', label: 'Longest print', description: 'Start with requests estimated to take longest.' },
    ],
  },
]

export const ARCHIVE_SORT_GROUPS: SortGroup[] = [
  {
    label: 'Archived',
    options: [
      { value: 'archived-desc', label: 'Recently archived', description: 'Show requests archived most recently first.' },
      { value: 'archived-asc', label: 'Oldest archived', description: 'Show requests archived longest ago first.' },
    ],
  },
  ...DEFAULT_SORT_GROUPS.filter((group) => group.label !== 'Queue strategy'),
]

const AVAILABILITY = [
  { value: '', label: 'Any' },
  { value: 'yes', label: 'Available' },
  { value: 'no', label: 'Missing' },
] as const
const EMPTY_TAGS: PrintGroup[] = []

export function BoardFilters({
  search,
  facets,
  onChange,
  presence,
  action,
  defaultSort = 'fair',
  ariaLabel = 'Board filters',
  description = 'Combine any fields to narrow the board.',
  showSort = true,
  sortGroups: sortGroupsProp = DEFAULT_SORT_GROUPS,
  prioritySortLabel = 'Requester priorities',
  showRoundRobin = false,
  className,
  tags = EMPTY_TAGS,
  onManageTags,
}: {
  search: BoardSearch
  facets: RequestFacets
  onChange: (patch: Partial<BoardSearch>, replace?: boolean) => void
  presence?: ReactNode
  action?: ReactNode
  defaultSort?: BoardSort
  ariaLabel?: string
  description?: string
  showSort?: boolean
  sortGroups?: SortGroup[]
  prioritySortLabel?: 'My priority' | 'Requester priorities'
  showRoundRobin?: boolean
  className?: string
  tags?: PrintGroup[]
  onManageTags?: () => void
}) {
  const queryTimer = useRef<number | undefined>(undefined)
  const [hydrated, setHydrated] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState(search.q ?? '')
  const printTypes = availablePrintTypes()
  const showPrintType = true
  const sortGroups = sortGroupsProp.map((group) => ({
    ...group,
    options: group.options
      .filter((sort) => showRoundRobin || sort.value !== 'round-robin')
      .map((sort) => (sort.value === 'fair' ? { ...sort, label: prioritySortLabel } : sort)),
  }))
  const sorts = sortGroups.flatMap((group) => group.options)
  const activeSort = sorts.find((sort) => sort.value === (search.sort ?? defaultSort)) ?? sorts[0]

  useEffect(() => setQuery(search.q ?? ''), [search.q])
  useEffect(() => setHydrated(true), [])
  useEffect(() => () => window.clearTimeout(queryTimer.current), [])

  const tagOptions = useMemo(
    () =>
      printGroupRows(tags).map((row) => ({
        value: row.group.id,
        label: row.path,
        depth: row.depth,
        name: row.group.name,
        color: row.group.color,
      })),
    [tags],
  )
  const active = activeBoardFilters(search, facets, tagOptions.find((option) => option.value === search.tag)?.label)
  const advanced = active.length
  const previousAdvanced = useRef(advanced)

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
      minMaterial: undefined,
      maxMaterial: undefined,
      createdAfter: undefined,
      createdBefore: undefined,
      updatedAfter: undefined,
      updatedBefore: undefined,
      hasNotes: undefined,
      hasSource: undefined,
      hasThumbnail: undefined,
      hasPreview: undefined,
      printType: undefined,
      printer: undefined,
      tag: undefined,
      sort: undefined,
    })
  }

  useEffect(() => {
    if (previousAdvanced.current === 0 && advanced > 0) signalProductTourProgress('filter')
    previousAdvanced.current = advanced
  }, [advanced])

  return (
    <section className={cn('relative z-5 bg-background px-3 pt-2.5', className)} aria-label={ariaLabel} data-hydrated={hydrated}>
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

        {showSort && (
          <Menu>
            <MenuTrigger
              render={<Button type="button" variant="outline" aria-label={`Sort requests: ${activeSort.label}`} data-onboarding="sort" />}
            >
              <ArrowUpDown />
              <span>Sort</span>
            </MenuTrigger>
            <MenuContent
              aria-label="Sort requests"
              align="start"
              sideOffset={8}
              className="max-h-[min(24rem,var(--available-height))] w-72"
            >
              <MenuRadioGroup
                value={activeSort.value}
                onValueChange={(value: BoardSort) => {
                  signalProductTourProgress('sort')
                  onChange({ sort: value === defaultSort ? undefined : value })
                }}
              >
                {sortGroups.map((group) => (
                  <MenuGroup key={group.label} className="p-0.5">
                    <MenuGroupLabel>{group.label}</MenuGroupLabel>
                    {group.options.map((sort) => {
                      const selected = sort.value === activeSort.value
                      return (
                        <MenuRadioItem key={sort.value} value={sort.value} closeOnClick title={sort.description}>
                          <span className="min-w-0 flex-1 truncate">{sort.label}</span>
                          <Check className={cn(!selected && 'invisible')} />
                        </MenuRadioItem>
                      )
                    })}
                  </MenuGroup>
                ))}
              </MenuRadioGroup>
            </MenuContent>
          </Menu>
        )}

        <Popover open={expanded} onOpenChange={setExpanded}>
          <PopoverTrigger render={<Button type="button" variant="outline" data-onboarding="filters" />}>
            <SlidersHorizontal />
            Filters
            {advanced > 0 && (
              <span className="rounded-full bg-primary px-1.5 font-mono text-[10px] text-primary-foreground">{advanced}</span>
            )}
          </PopoverTrigger>
          <PopoverContent
            align="start"
            sideOffset={8}
            className="max-h-[var(--available-height)] w-[min(680px,calc(100vw-24px))] gap-0 overflow-hidden p-0"
          >
            <header className="flex shrink-0 items-start justify-between border-b-2 border-dashed border-blueprint/25 p-3">
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
            <div className="grid min-h-0 grid-cols-2 gap-3 overflow-y-auto overscroll-contain p-3 max-[640px]:grid-cols-1">
              {showPrintType && (
                <section className="grid content-start gap-2">
                  <h3 className="font-heading text-xs font-semibold tracking-wide uppercase text-muted-foreground">Print type</h3>
                  <Select
                    items={[
                      { value: '', label: 'All print types' },
                      ...printTypes.map((printType) => ({ value: printType, label: printTypeLabel(printType) })),
                    ]}
                    value={search.printType ?? ''}
                    onValueChange={(value) => onChange({ printType: (value || undefined) as PrintType | undefined, printer: undefined })}
                  >
                    <SelectTrigger className="w-full" aria-label="Filter by print type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">All print types</SelectItem>
                      {printTypes.map((printType) => (
                        <SelectItem key={printType} value={printType}>
                          {printTypeLabel(printType)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </section>
              )}
              {tagOptions.length > 0 && (
                <section className="grid content-start gap-2">
                  <h3 className="font-heading text-xs font-semibold tracking-wide uppercase text-muted-foreground">Tag</h3>
                  <FilterCombobox
                    ariaLabel="Filter by tag"
                    value={search.tag}
                    onChange={(tag) => onChange({ tag })}
                    options={tagOptions}
                    placeholder="Any tag"
                    emptyLabel="No tags found."
                    renderOption={(option) => <TagTreeRow depth={option.depth} color={option.color} name={option.name} />}
                    optionAriaLabel={(option) => option.label}
                  />
                </section>
              )}
              <section className="ph-no-capture grid content-start gap-2">
                <h3 className="font-heading text-xs font-semibold tracking-wide uppercase text-muted-foreground">Requester</h3>
                <FilterCombobox
                  ariaLabel="Filter by requester"
                  value={search.requester}
                  onChange={(requester) => onChange({ requester })}
                  placeholder="Anyone"
                  emptyLabel="No people found."
                  redacted
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
                    min={MIN_REQUEST_QUANTITY}
                    max={MAX_REQUEST_QUANTITY}
                    placeholder="Minimum"
                    value={search.minQuantity ?? ''}
                    onChange={(event) => onChange({ minQuantity: event.target.value ? Number(event.target.value) : undefined })}
                  />
                  <Input
                    aria-label="Maximum quantity"
                    type="number"
                    min={MIN_REQUEST_QUANTITY}
                    max={MAX_REQUEST_QUANTITY}
                    placeholder="Maximum"
                    value={search.maxQuantity ?? ''}
                    onChange={(event) => onChange({ maxQuantity: event.target.value ? Number(event.target.value) : undefined })}
                  />
                </div>
              </section>
              <section className="grid content-start gap-2">
                <h3 className="font-heading text-xs font-semibold tracking-wide uppercase text-muted-foreground">Material per copy</h3>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    aria-label="Minimum estimated material per copy"
                    type="number"
                    min="0"
                    step="any"
                    placeholder="Minimum"
                    value={search.minMaterial ?? ''}
                    onChange={(event) => onChange({ minMaterial: event.target.value ? Number(event.target.value) : undefined })}
                  />
                  <Input
                    aria-label="Maximum estimated material per copy"
                    type="number"
                    min="0"
                    step="any"
                    placeholder="Maximum"
                    value={search.maxMaterial ?? ''}
                    onChange={(event) => onChange({ maxMaterial: event.target.value ? Number(event.target.value) : undefined })}
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
              <section className="col-span-2 grid grid-cols-4 gap-2 max-[640px]:col-span-1 max-[640px]:grid-cols-2">
                <h3 className="col-span-full font-heading text-xs font-semibold tracking-wide uppercase text-muted-foreground">Metadata</h3>
                {BOARD_METADATA_FILTERS.map(([key, label]) => (
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
            <footer className="flex shrink-0 justify-end gap-2 border-t bg-muted/30 p-2">
              <Button type="button" variant="ghost" size="sm" onClick={clear}>
                Reset all filters
              </Button>
              <Button type="button" size="sm" onClick={() => setExpanded(false)}>
                Done
              </Button>
            </footer>
          </PopoverContent>
        </Popover>
        {onManageTags && (
          <Button type="button" variant="outline" onClick={onManageTags}>
            <Tags />
            Tags
          </Button>
        )}

        <div className="flex-1 max-[900px]:hidden" />
        {presence}
        {action}
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
