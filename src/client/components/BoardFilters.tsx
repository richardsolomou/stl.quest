import { useCallback, useEffect, useRef, useState } from 'react'
import { Menu } from '@base-ui/react/menu'
import { ArrowUpDown, Check, Search, SlidersHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { BoardSort, PrintType, RequestFacets } from '../../core/types'
import { DatePicker } from './DatePicker'
import { PeopleCombobox } from './PeopleCombobox'
import type { BoardSearch } from '../boardSearch'
import { availablePrintTypes, printTypeLabel } from '../fleet'

const SORT_GROUPS: { label: string; options: { value: BoardSort; label: string; description: string }[] }[] = [
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
    ],
  },
]

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

export function BoardFilters({
  search,
  facets,
  onChange,
  defaultSort = 'fair',
  ariaLabel = 'Board filters',
  description = 'Combine any fields to narrow the board.',
  showSort = true,
  prioritySortLabel = 'Requester priorities',
  showRoundRobin = false,
  className,
}: {
  search: BoardSearch
  facets: RequestFacets
  onChange: (patch: Partial<BoardSearch>, replace?: boolean) => void
  defaultSort?: BoardSort
  ariaLabel?: string
  description?: string
  showSort?: boolean
  prioritySortLabel?: 'My priority' | 'Requester priorities'
  showRoundRobin?: boolean
  className?: string
}) {
  const queryTimer = useRef<number | undefined>(undefined)
  const [hydrated, setHydrated] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState(search.q ?? '')
  const printTypes = availablePrintTypes()
  const showPrintType = true
  const sortGroups = SORT_GROUPS.map((group) => ({
    ...group,
    options: group.options
      .filter((sort) => showRoundRobin || sort.value !== 'round-robin')
      .map((sort) => (sort.value === 'fair' ? { ...sort, label: prioritySortLabel } : sort)),
  }))
  const sorts = sortGroups.flatMap((group) => group.options)
  const activeSort = sorts.find((sort) => sort.value === (search.sort ?? defaultSort)) ?? sorts[0]
  const selectedRequester = facets.requesters.find((requester) => requester.value === search.requester)

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
    showPrintType && search.printType,
  ].filter(Boolean).length

  const active = [
    showPrintType && search.printType && { key: 'printType', label: printTypeLabel(search.printType) },
    search.requester && { key: 'requester', label: selectedRequester?.label ?? search.requester },
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
      printType: undefined,
      printer: undefined,
      sort: undefined,
    })
  }

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

        <div className="flex-1 max-[900px]:hidden" />
        <span className="inline-flex items-center gap-1.5 font-mono text-xs whitespace-nowrap text-muted-foreground" aria-live="polite">
          {facets.total === facets.available ? facets.total : `${facets.total} / ${facets.available}`}
        </span>
        {showSort && (
          <Menu.Root>
            <Menu.Trigger
              render={<Button type="button" variant="outline" aria-label={`Sort requests: ${activeSort.label}`} className="max-w-64" />}
            >
              <ArrowUpDown />
              <span>Sort</span>
              <span className="truncate text-muted-foreground">{activeSort.label}</span>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner align="end" sideOffset={8} className="isolate z-50">
                <Menu.Popup
                  aria-label="Sort requests"
                  className="z-50 max-h-[min(24rem,var(--available-height))] w-72 origin-(--transform-origin) overflow-y-auto overscroll-contain rounded-lg bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
                >
                  <Menu.RadioGroup
                    value={activeSort.value}
                    onValueChange={(value: BoardSort) => onChange({ sort: value === defaultSort ? undefined : value })}
                  >
                    {sortGroups.map((group) => (
                      <Menu.Group key={group.label} className="p-0.5">
                        <Menu.GroupLabel className="px-2 py-1 text-xs text-muted-foreground">{group.label}</Menu.GroupLabel>
                        {group.options.map((sort) => {
                          const selected = sort.value === activeSort.value
                          return (
                            <Menu.RadioItem
                              key={sort.value}
                              value={sort.value}
                              closeOnClick
                              className="flex h-8 w-full cursor-default items-center justify-start gap-2 rounded-lg px-2 text-left outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                              title={sort.description}
                            >
                              <span className="min-w-0 flex-1 truncate">{sort.label}</span>
                              <Check className={cn(!selected && 'invisible')} />
                            </Menu.RadioItem>
                          )
                        })}
                      </Menu.Group>
                    ))}
                  </Menu.RadioGroup>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        )}

        <Popover open={expanded} onOpenChange={setExpanded}>
          <PopoverTrigger render={<Button type="button" variant={advanced > 0 ? 'outline' : 'ghost'} />}>
            <SlidersHorizontal />
            Filters
            {advanced > 0 && (
              <span className="rounded-full bg-primary px-1.5 font-mono text-[10px] text-primary-foreground">{advanced}</span>
            )}
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={8}
            className="max-h-[var(--available-height)] w-[min(680px,calc(100vw-24px))] gap-0 overflow-hidden p-0"
          >
            <header className="flex shrink-0 items-start justify-between border-b p-3">
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
              <section className="col-span-2 grid grid-cols-4 gap-2 max-[640px]:col-span-1 max-[640px]:grid-cols-2">
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
