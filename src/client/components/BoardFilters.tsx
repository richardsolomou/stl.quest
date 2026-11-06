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
import type { Messages } from '../../core/i18n'
import { useI18n } from '../i18n'

export type SortGroup = { id: keyof Messages['board']['sort']['groups']; options: (keyof Messages['board']['sort']['options'])[] }

export const DEFAULT_SORT_GROUPS: SortGroup[] = [
  { id: 'strategy', options: ['fair', 'round-robin'] },
  { id: 'submitted', options: ['created-asc', 'created-desc'] },
  {
    id: 'details',
    options: ['name-asc', 'name-desc', 'updated-desc', 'updated-asc', 'material-asc', 'material-desc', 'time-asc', 'time-desc'],
  },
]

export const ARCHIVE_SORT_GROUPS: SortGroup[] = [
  { id: 'archived', options: ['archived-desc', 'archived-asc'] },
  ...DEFAULT_SORT_GROUPS.filter((group) => group.id !== 'strategy'),
]

const AVAILABILITY = ['', 'yes', 'no'] as const
const AVAILABILITY_KEY = { '': 'any', yes: 'yes', no: 'no' } as const
const EMPTY_TAGS: PrintGroup[] = []

export function BoardFilters({
  search,
  facets,
  onChange,
  presence,
  action,
  defaultSort = 'fair',
  ariaLabel,
  description,
  showSort = true,
  sortGroups: sortGroupsProp = DEFAULT_SORT_GROUPS,
  prioritySortLabel,
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
  /** Overrides the label of the requester-priority sort, e.g. for a requester sorting their own prints. */
  prioritySortLabel?: string
  showRoundRobin?: boolean
  className?: string
  tags?: PrintGroup[]
  onManageTags?: () => void
}) {
  const { t } = useI18n()
  const f = t.board.filters
  const queryTimer = useRef<number | undefined>(undefined)
  const [hydrated, setHydrated] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState(search.q ?? '')
  const printTypes = availablePrintTypes()
  const showPrintType = true
  const sortGroups = sortGroupsProp.map((group) => ({
    id: group.id,
    label: t.board.sort.groups[group.id],
    options: group.options
      .filter((value) => showRoundRobin || value !== 'round-robin')
      .map((value) => {
        const text = t.board.sort.options[value]
        return { value, description: text.description, label: (value === 'fair' && prioritySortLabel) || text.label }
      }),
  }))
  const availability = AVAILABILITY.map((value) => ({ value, label: f.availability[AVAILABILITY_KEY[value]] }))
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
  const active = activeBoardFilters(t, search, facets, tagOptions.find((option) => option.value === search.tag)?.label)
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
    <section
      className={cn('relative z-5 bg-background px-3 pt-2.5', className)}
      aria-label={ariaLabel ?? f.ariaLabel}
      data-hydrated={hydrated}
    >
      <div className="flex min-h-9.5 items-center gap-2 max-[900px]:flex-wrap">
        <InputGroup className="w-[clamp(190px,24vw,340px)] bg-card max-[900px]:w-full">
          <InputGroupAddon>
            <Search aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            aria-label={f.searchAria}
            value={query}
            onChange={(event) => updateQuery(event.target.value)}
            placeholder={f.searchPlaceholder}
          />
          {query && (
            <InputGroupAddon align="inline-end">
              <Tooltip>
                <TooltipTrigger render={<InputGroupButton size="icon-xs" aria-label={f.clearSearch} onClick={clearQuery} />}>
                  <X />
                </TooltipTrigger>
                <TooltipContent>{f.clearSearch}</TooltipContent>
              </Tooltip>
            </InputGroupAddon>
          )}
        </InputGroup>

        {showSort && (
          <Menu>
            <MenuTrigger
              render={<Button type="button" variant="outline" aria-label={f.sortAria(activeSort.label)} data-onboarding="sort" />}
            >
              <ArrowUpDown />
              <span>{f.sort}</span>
            </MenuTrigger>
            <MenuContent
              aria-label={f.sortMenuAria}
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
                  <MenuGroup key={group.id} className="p-0.5">
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
            {f.filters}
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
                <PopoverTitle>{f.moreFilters}</PopoverTitle>
                <PopoverDescription>{description ?? f.description}</PopoverDescription>
              </PopoverHeader>
              <Tooltip>
                <TooltipTrigger
                  render={<Button type="button" variant="ghost" size="icon-sm" aria-label={f.close} onClick={() => setExpanded(false)} />}
                >
                  <X />
                </TooltipTrigger>
                <TooltipContent>{f.close}</TooltipContent>
              </Tooltip>
            </header>
            <div className="grid min-h-0 grid-cols-2 gap-3 overflow-y-auto overscroll-contain p-3 max-[640px]:grid-cols-1">
              {showPrintType && (
                <section className="grid content-start gap-2">
                  <h3 className="font-heading text-xs font-semibold tracking-wide uppercase text-muted-foreground">{f.printType}</h3>
                  <Select
                    items={[
                      { value: '', label: f.allPrintTypes },
                      ...printTypes.map((printType) => ({ value: printType, label: printTypeLabel(t, printType) })),
                    ]}
                    value={search.printType ?? ''}
                    onValueChange={(value) => onChange({ printType: (value || undefined) as PrintType | undefined, printer: undefined })}
                  >
                    <SelectTrigger className="w-full" aria-label={f.printTypeAria}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">{f.allPrintTypes}</SelectItem>
                      {printTypes.map((printType) => (
                        <SelectItem key={printType} value={printType}>
                          {printTypeLabel(t, printType)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </section>
              )}
              {tagOptions.length > 0 && (
                <section className="grid content-start gap-2">
                  <h3 className="font-heading text-xs font-semibold tracking-wide uppercase text-muted-foreground">{f.tag}</h3>
                  <FilterCombobox
                    ariaLabel={f.tagAria}
                    value={search.tag}
                    onChange={(tag) => onChange({ tag })}
                    options={tagOptions}
                    placeholder={f.anyTag}
                    emptyLabel={f.noTags}
                    renderOption={(option) => <TagTreeRow depth={option.depth} color={option.color} name={option.name} />}
                    optionAriaLabel={(option) => option.label}
                  />
                </section>
              )}
              <section className="ph-no-capture grid content-start gap-2">
                <h3 className="font-heading text-xs font-semibold tracking-wide uppercase text-muted-foreground">{f.requester}</h3>
                <FilterCombobox
                  ariaLabel={f.requesterAria}
                  value={search.requester}
                  onChange={(requester) => onChange({ requester })}
                  placeholder={f.anyone}
                  emptyLabel={f.noPeople}
                  redacted
                  options={facets.requesters.map((requester) => ({
                    value: requester.value,
                    label: `${requester.label} · ${requester.count}`,
                  }))}
                />
              </section>
              <section className="grid content-start gap-2">
                <h3 className="font-heading text-xs font-semibold tracking-wide uppercase text-muted-foreground">{f.quantity}</h3>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    aria-label={f.minQuantity}
                    type="number"
                    min={MIN_REQUEST_QUANTITY}
                    max={MAX_REQUEST_QUANTITY}
                    placeholder={f.minimum}
                    value={search.minQuantity ?? ''}
                    onChange={(event) => onChange({ minQuantity: event.target.value ? Number(event.target.value) : undefined })}
                  />
                  <Input
                    aria-label={f.maxQuantity}
                    type="number"
                    min={MIN_REQUEST_QUANTITY}
                    max={MAX_REQUEST_QUANTITY}
                    placeholder={f.maximum}
                    value={search.maxQuantity ?? ''}
                    onChange={(event) => onChange({ maxQuantity: event.target.value ? Number(event.target.value) : undefined })}
                  />
                </div>
              </section>
              <section className="grid content-start gap-2">
                <h3 className="font-heading text-xs font-semibold tracking-wide uppercase text-muted-foreground">{f.material}</h3>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    aria-label={f.minMaterial}
                    type="number"
                    min="0"
                    step="any"
                    placeholder={f.minimum}
                    value={search.minMaterial ?? ''}
                    onChange={(event) => onChange({ minMaterial: event.target.value ? Number(event.target.value) : undefined })}
                  />
                  <Input
                    aria-label={f.maxMaterial}
                    type="number"
                    min="0"
                    step="any"
                    placeholder={f.maximum}
                    value={search.maxMaterial ?? ''}
                    onChange={(event) => onChange({ maxMaterial: event.target.value ? Number(event.target.value) : undefined })}
                  />
                </div>
              </section>
              <section className="grid content-start gap-2">
                <h3 className="font-heading text-xs font-semibold tracking-wide uppercase text-muted-foreground">{f.created}</h3>
                <div className="grid grid-cols-2 gap-2">
                  <DatePicker label={f.after} value={search.createdAfter} onChange={(createdAfter) => onChange({ createdAfter })} />
                  <DatePicker label={f.before} value={search.createdBefore} onChange={(createdBefore) => onChange({ createdBefore })} />
                </div>
              </section>
              <section className="grid content-start gap-2">
                <h3 className="font-heading text-xs font-semibold tracking-wide uppercase text-muted-foreground">{f.lastUpdated}</h3>
                <div className="grid grid-cols-2 gap-2">
                  <DatePicker label={f.after} value={search.updatedAfter} onChange={(updatedAfter) => onChange({ updatedAfter })} />
                  <DatePicker label={f.before} value={search.updatedBefore} onChange={(updatedBefore) => onChange({ updatedBefore })} />
                </div>
              </section>
              <section className="col-span-2 grid grid-cols-4 gap-2 max-[640px]:col-span-1 max-[640px]:grid-cols-2">
                <h3 className="col-span-full font-heading text-xs font-semibold tracking-wide uppercase text-muted-foreground">
                  {f.metadata}
                </h3>
                {BOARD_METADATA_FILTERS.map((key) => (
                  <label className="grid gap-1 text-xs text-muted-foreground" key={key}>
                    <span>{f.metadataFields[key]}</span>
                    <Select
                      items={availability}
                      value={search[key] === undefined ? '' : search[key] ? 'yes' : 'no'}
                      onValueChange={(value) => onChange({ [key]: value === '' ? undefined : value === 'yes' })}
                    >
                      <SelectTrigger className="w-full" aria-label={f.availabilityAria(f.metadataFields[key])}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {availability.map((option) => (
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
                {f.resetAll}
              </Button>
              <Button type="button" size="sm" onClick={() => setExpanded(false)}>
                {t.common.done}
              </Button>
            </footer>
          </PopoverContent>
        </Popover>
        {onManageTags && (
          <Button type="button" variant="outline" onClick={onManageTags}>
            <Tags />
            {f.tags}
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
            {f.clearAll}
          </Button>
        </div>
      )}
    </section>
  )
}
