import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu'
import { cn } from '@/lib/utils'
import {
  consumablePrice,
  consumablesOfKind,
  partCostPerHour,
  partCostPerPlate,
  newWearPart,
  wearPartGroups,
  withConsumablePrice,
  type Consumable,
  type FilamentConsumable,
  type WearPartGroup,
} from '../../../core/consumables'
import { filamentConsumableName, filamentFromPreset, filamentProductGroups, type FilamentPreset } from '../../../core/filamentPresets'
import { partPresetsForGroup } from '../../../core/partPresets'
import { findPreset } from '../../../core/presets'
import { DEFAULT_PRICE_CALCULATOR_SETTINGS, TYPICAL_RESIN_DENSITY_GRAMS_PER_ML } from '../../../core/priceCalculator'
import { getPrinterPreset } from '../../../core/printerPresets'
import { printTypeCopy } from '../../../core/printTypes'
import { resinFromPreset, type ResinPreset } from '../../../core/resinPresets'
import { partFromPreset, type PartSuggestion } from '../../../core/stock'
import { PRINT_TYPES, type PrintType } from '../../../core/types'
import type { StockLevel } from '../../../core/usage'
import { useI18n } from '../../i18n'
import { useConsumableBatch, useInventory } from '../../inventory'
import { activeItems } from '../../../core/inventory'
import { createId } from '../../id'
import { matchesListSearch, showsListSearch } from '../../listSearch'
import { catalogueQuery, consumablesQuery, priceCalculatorSettingsQuery, printersQuery, stockQuery } from '../../queries'
import { signalProductTourProgress } from '../../productTour'
import { useUsageTracking, useWorkspacePrintTypes, useWorkspaceSlug } from '../../workspace'
import { UsageTrackingInvite } from '../UsageTracking'
import { currencySymbol, formatMoney, formatNumber, formatRate } from '../priceCalculator/format'
import { QueryState } from '../QueryState'
import { ColourSwatch } from '../ColourSwatch'
import { AlsoPrints } from './AlsoPrints'
import { ArchivedInventory } from './ArchivedInventory'
import { ConsumableDialog } from './ConsumableDialog'
import { ConsumableIcon } from './ConsumableIcon'
import { materialFacts, MaterialPicker, PartPicker } from './ConsumablePicker'
import { LowMarker, StockSummary } from './ConsumableStock'
import { VirtualList } from './VirtualList'
import { PrinterPresetImage } from './PrinterPresetImage'
import { PageHeader, SettingsPage, SettingsSection } from './SettingsLayout'
import { SupplyNeeds } from './SupplyNeeds'

type LabelledGroup = WearPartGroup & { label: string }
type ProductEntry = { type: 'product'; presetId: string; filaments: FilamentConsumable[]; open: boolean }
type ListEntry = ProductEntry | { type: 'item'; consumable: Consumable; nested?: boolean }

// A product line shows this many swatches, fewer on a phone, beside its colour count.
const PRODUCT_SWATCHES = 12
const NARROW_PRODUCT_SWATCHES = 3
type Picking = { kind: PrintType } | { kind: 'part'; group: LabelledGroup }

export function ConsumablesPane() {
  const workspaceSlug = useWorkspaceSlug()
  const copy = useI18n().t.settings.consumables
  const printTypes = useWorkspacePrintTypes()
  const query = useQuery(consumablesQuery(workspaceSlug))
  const saved = query.data?.consumables
  // The library's rows say what the catalogue knows of them, so the page waits for the catalogues its items come from.
  const usesResins = Boolean(saved?.some((item) => item.kind === 'resin' && item.resinPresetId))
  const usesFilaments = Boolean(saved?.some((item) => item.kind === 'filament' && item.filamentPresetId))
  const resins = useQuery({ ...catalogueQuery('resins'), enabled: usesResins })
  const filaments = useQuery({ ...catalogueQuery('filaments'), enabled: usesFilaments })
  const parts = useQuery(catalogueQuery('parts'))
  if (!saved || (usesResins && resins.isPending) || (usesFilaments && filaments.isPending) || parts.isPending) {
    return (
      <SettingsPage>
        <PageHeader title={copy.title} description={copy.description[printTypeCopy(printTypes)]} />
        <QueryState
          loading={!query.error}
          error={query.error}
          loadingLabel={copy.loading}
          errorTitle={copy.loadError}
          onRetry={() => void query.refetch()}
        />
      </SettingsPage>
    )
  }
  return <LoadedConsumablesPane workspaceSlug={workspaceSlug} saved={saved} />
}

/** The library as rows that open one dialog per consumable, each stored straight away from it, as printers are. */
function LoadedConsumablesPane({ workspaceSlug, saved }: { workspaceSlug: string; saved: Consumable[] }) {
  const { t, locale } = useI18n()
  const copy = t.settings.consumables
  const currency =
    useQuery(priceCalculatorSettingsQuery(workspaceSlug)).data?.settings.currency ?? DEFAULT_PRICE_CALCULATOR_SETTINGS.currency
  const symbol = currencySymbol(currency, locale)
  const money = (value: number) => formatMoney(value, currency, locale)
  const rate = (value: number) => formatRate(value, currency, locale)
  const profiles = useQuery(printersQuery(workspaceSlug)).data?.profiles
  const printers = useMemo(() => profiles ?? [], [profiles])
  const printTypes = useWorkspacePrintTypes()
  const tracking = useUsageTracking()
  const stock = useQuery({ ...stockQuery(workspaceSlug), enabled: tracking }).data?.stock
  const levels = useMemo(() => stock ?? [], [stock])
  const { mutation, save, setArchived, remove } = useInventory('consumables')
  const batch = useConsumableBatch()
  // A new item scrolls into view once it is stored, so it is found where it landed when its dialog closes.
  const [added, setAdded] = useState<string>()
  const saveItem = async (item: Consumable) => {
    const isNew = !saved.some(({ id }) => id === item.id)
    await save(item)
    if (isNew) setAdded(item.id)
    if (isNew && (item.kind === 'resin' || item.kind === 'filament')) signalProductTourProgress('stock')
  }
  const addColours = async (items: FilamentConsumable[], onHand?: number) => {
    await batch.add.mutateAsync({ items, onHand })
    setAdded(items[0].id)
    signalProductTourProgress('stock')
  }
  // Products whose colours are listed under them; the rest show as one line with their swatches.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const toggleProduct = (presetId: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(presetId)) next.add(presetId)
      return next
    })
  // A new item is kept here, not in the list, until its dialog has what it needs and stores it.
  const [editing, setEditing] = useState<Consumable | null>(null)
  const [picking, setPicking] = useState<Picking | null>(null)
  // Read from the cache the page filled, or fetched once a picker for a catalogue not yet shown opens.
  const resins = useQuery({ ...catalogueQuery('resins'), enabled: picking?.kind === 'resin' }).data
  const filaments = useQuery({ ...catalogueQuery('filaments'), enabled: picking?.kind === 'filament' }).data
  const partCatalogue = useQuery(catalogueQuery('parts')).data
  const failed = () => void toast.error(copy.notSaved)
  const archive = (item: Consumable) => {
    setEditing(null)
    setArchived(item.id, true).then(
      () =>
        toast(copy.archivedItem(item.name), {
          action: { label: copy.undo, onClick: () => void setArchived(item.id, false).catch(failed) },
        }),
      failed,
    )
  }

  const addMaterial = (kind: PrintType) => setPicking({ kind })
  const addSupply = () => setEditing({ id: createId(), kind: 'supply', name: '', unit: 'ml', price: Number.NaN })
  const addCustomPart = (group: WearPartGroup) => setEditing(newWearPart(createId(), group))
  const addPart = (group: LabelledGroup) =>
    !partCatalogue || partPresetsForGroup(partCatalogue, group).length ? setPicking({ kind: 'part', group }) : addCustomPart(group)
  // The catalogue knows no prices, so a part from it opens unpriced, with its list price as a hint.
  const addPresetPart = (suggestion: Pick<PartSuggestion, 'preset' | 'printerPresetId'> & { printerId?: string }) =>
    setEditing(withConsumablePrice(partFromPreset(createId(), suggestion), Number.NaN))

  const [search, setSearch] = useState('')
  const found = (item: Consumable) => matchesListSearch(search, [item.name])
  const partGroupLabel = (group: WearPartGroup) => {
    if (group.printerId) return printers.find(({ id }) => id === group.printerId)?.name ?? copy.parts.removedPrinter
    if (!group.printerPresetId) return copy.parts.every[group.printType]
    const preset = getPrinterPreset(group.printerPresetId)
    return preset ? `${preset.brand} ${preset.model}` : group.printerPresetId
  }
  const allPartGroups = wearPartGroups(saved, printers, printTypes).map((group) => ({ ...group, label: partGroupLabel(group) }))
  const typePartGroups = allPartGroups.filter((group) => group.printerPresetId === undefined && group.printerId === undefined)
  // Searching for a model shows its whole group, so a part can be added to it as well as found in it.
  const partGroups = allPartGroups.flatMap((group) => {
    const parts = matchesListSearch(search, [group.label]) ? group.parts : group.parts.filter(found)
    return parts.length || matchesListSearch(search, [group.label]) ? [{ ...group, parts }] : []
  })
  const partCount = consumablesOfKind(saved, 'part').length
  const active = activeItems(saved)
  const archived = saved.filter((item) => item.archived)
  const noMatches = search.trim() !== '' && !active.some((item) => item.kind !== 'part' && found(item)) && partGroups.length === 0
  // A material the workspace neither prints nor stocks folds to one invitation line instead of an empty section.
  const materials = {
    resin: { items: consumablesOfKind(saved, 'resin'), addLabel: copy.resins.add },
    filament: { items: consumablesOfKind(saved, 'filament'), addLabel: copy.filaments.add },
  }
  const shows = (printType: PrintType) => printTypes.includes(printType) || materials[printType].items.length > 0
  const level = (consumable: Consumable) => levels.find(({ consumableId }) => consumableId === consumable.id)
  const rows = (items: Consumable[]) => {
    // A filament product with several colours is one line that opens to its colours; a search shows the colours it found.
    const entries = filamentProductGroups(consumablesOfKind(items, 'filament')).flatMap(({ presetId, filaments: colours }): ListEntry[] => {
      if (!presetId) return [{ type: 'item', consumable: colours[0] }]
      const open = search.trim() !== '' || expanded.has(presetId)
      return [
        { type: 'product', presetId, filaments: colours, open },
        ...(open ? colours.map((consumable) => ({ type: 'item' as const, consumable, nested: true })) : []),
      ]
    })
    entries.push(...items.filter((item) => item.kind !== 'filament').map((consumable) => ({ type: 'item' as const, consumable })))
    const hidden = entries.find(
      (entry): entry is ProductEntry => entry.type === 'product' && !entry.open && entry.filaments.some(({ id }) => id === added),
    )
    return (
      entries.length > 0 && (
        <VirtualList
          items={entries}
          getKey={(entry) => (entry.type === 'product' ? `product:${entry.presetId}` : entry.consumable.id)}
          scrollToKey={hidden ? `product:${hidden.presetId}` : added}
          renderItem={(entry) =>
            entry.type === 'product' ? (
              <FilamentProductRow
                entry={entry}
                preset={findPreset(filaments, entry.presetId)}
                levels={entry.filaments.flatMap((filament) => level(filament) ?? [])}
                money={money}
                onToggle={() => toggleProduct(entry.presetId)}
              />
            ) : (
              <ConsumableRow
                consumable={entry.consumable}
                nested={entry.nested}
                preset={
                  entry.consumable.kind === 'resin'
                    ? findPreset(resins, entry.consumable.resinPresetId)
                    : entry.consumable.kind === 'filament'
                      ? findPreset(filaments, entry.consumable.filamentPresetId)
                      : undefined
                }
                level={level(entry.consumable)}
                money={money}
                rate={rate}
                onOpen={() => setEditing(entry.consumable)}
              />
            )
          }
        />
      )
    )
  }
  const supplies = consumablesOfKind(saved, 'supply')
  const kindTitles = { resin: copy.resins.title, filament: copy.filaments.title, supply: copy.supplies.title, part: copy.parts.title }

  return (
    <SettingsPage data-saving={mutation.isPending}>
      <PageHeader
        title={copy.title}
        description={copy.description[printTypeCopy(printTypes)]}
        actions={
          <Menu>
            <MenuTrigger render={<Button type="button" data-onboarding="consumables-add" />}>
              <Plus /> {copy.add}
            </MenuTrigger>
            <MenuContent align="end" className="w-auto">
              {shows('resin') && <MenuItem onClick={() => addMaterial('resin')}>{copy.resins.add}</MenuItem>}
              {shows('filament') && <MenuItem onClick={() => addMaterial('filament')}>{copy.filaments.add}</MenuItem>}
              <MenuItem onClick={addSupply}>{copy.supplies.add}</MenuItem>
              {typePartGroups.map((group) => (
                <MenuItem key={group.printType} onClick={() => addPart(group)}>
                  {typePartGroups.length === 1 ? copy.parts.addWearPart : copy.parts.addTypeWearPart[group.printType]}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
        }
      />
      {tracking ? (
        <SupplyNeeds
          workspaceSlug={workspaceSlug}
          consumables={saved}
          levels={stock}
          printers={printers}
          printTypes={printTypes}
          onAddMaterial={addMaterial}
          onAddPart={addPresetPart}
        />
      ) : (
        <UsageTrackingInvite source="consumables" line={t.settings.board.tracking.invite.consumables} />
      )}
      {showsListSearch(active.length) && (
        <InputGroup className="max-w-sm bg-field">
          <InputGroupAddon>
            <Search aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            aria-label={copy.search}
            placeholder={copy.search}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </InputGroup>
      )}
      {noMatches && <p className="text-sm text-muted-foreground">{copy.noMatches(search.trim())}</p>}
      {PRINT_TYPES.filter(shows).map((printType) => {
        const section = printType === 'resin' ? copy.resins : copy.filaments
        return (
          <ConsumableSection
            key={printType}
            count={materials[printType].items.length}
            title={section.title}
            description={section.description}
            empty={section.empty}
            addLabel={section.add}
            onAdd={() => addMaterial(printType)}
          >
            {rows(materials[printType].items.filter(found))}
          </ConsumableSection>
        )
      })}
      {PRINT_TYPES.filter((printType) => !shows(printType)).map((printType) => (
        <AlsoPrints key={printType} printType={printType}>
          <Button type="button" variant="link" size="sm" onClick={() => addMaterial(printType)}>
            {materials[printType].addLabel}
          </Button>
        </AlsoPrints>
      ))}
      <ConsumableSection
        count={supplies.length}
        title={copy.supplies.title}
        description={copy.supplies.description[printTypeCopy(printTypes)]}
        empty={copy.supplies.empty}
        addLabel={copy.supplies.add}
        onAdd={addSupply}
      >
        {rows(supplies.filter(found))}
      </ConsumableSection>
      <SettingsSection
        layout="stacked"
        title={partCount ? `${copy.parts.title} · ${partCount}` : copy.parts.title}
        description={copy.parts.description}
      >
        <div className="grid gap-4">
          {partGroups.map((group) => (
            <PartGroup key={group.printerId ?? group.printerPresetId ?? group.printType} group={group} onAdd={() => addPart(group)}>
              {rows(group.parts)}
            </PartGroup>
          ))}
        </div>
      </SettingsSection>

      <ArchivedInventory
        kind="consumables"
        title={copy.archived.title}
        description={copy.archived.description}
        restoreLabel={copy.archived.restore}
        items={archived.map((item) => ({ id: item.id, name: item.name, detail: kindTitles[item.kind] }))}
        pending={mutation.isPending}
        onRestore={(id) => void setArchived(id, false).catch(failed)}
        onDelete={remove}
      />

      {picking?.kind === 'resin' && (
        <MaterialPicker
          kind="resin"
          presets={resins}
          added={presetIds(materials.resin.items.map(({ resinPresetId }) => resinPresetId))}
          onSelect={(preset) => setEditing(resinFromPreset(createId(), preset))}
          onCustom={(name = '') =>
            setEditing({
              id: createId(),
              kind: 'resin',
              name,
              pricePerLitre: Number.NaN,
              densityGramsPerMl: TYPICAL_RESIN_DENSITY_GRAMS_PER_ML,
            })
          }
          onClose={() => setPicking(null)}
        />
      )}
      {picking?.kind === 'filament' && (
        <MaterialPicker
          kind="filament"
          presets={filaments}
          added={presetIds(materials.filament.items.map(({ filamentPresetId }) => filamentPresetId))}
          onSelect={(preset) => setEditing(filamentFromPreset(createId(), preset))}
          onCustom={(name = '') => setEditing({ id: createId(), kind: 'filament', name, pricePerKg: Number.NaN })}
          onClose={() => setPicking(null)}
        />
      )}
      {picking?.kind === 'part' && (
        <PartPicker
          title={copy.parts.addTo(picking.group.label)}
          presets={partCatalogue && partPresetsForGroup(partCatalogue, picking.group)}
          had={presetIds(picking.group.parts.map(({ partPresetId }) => partPresetId))}
          onSelect={(preset) =>
            addPresetPart({ preset, printerPresetId: picking.group.printerPresetId, printerId: picking.group.printerId })
          }
          onCustom={() => addCustomPart(picking.group)}
          onClose={() => setPicking(null)}
        />
      )}
      {editing && (
        <ConsumableDialog
          key={editing.id}
          consumable={editing}
          isNew={!saved.some(({ id }) => id === editing.id)}
          library={saved}
          workspaceSlug={workspaceSlug}
          level={levels.find(({ consumableId }) => consumableId === editing.id)}
          printers={printers}
          symbol={symbol}
          rate={rate}
          onSave={saveItem}
          onAddColours={addColours}
          onArchive={() => archive(editing)}
          onClose={() => setEditing(null)}
        />
      )}
    </SettingsPage>
  )
}

function presetIds(ids: (string | undefined)[]) {
  return new Set(ids.filter((id): id is string => id !== undefined))
}

function ConsumableSection({
  count,
  title,
  description,
  empty,
  addLabel,
  onAdd,
  children,
}: {
  /** Items of this kind before any search narrows them, so a filtered-out section is not mistaken for an empty one. */
  count: number
  title: string
  description: string
  empty: string
  addLabel: string
  onAdd: () => void
  children: ReactNode
}) {
  return (
    <SettingsSection
      layout="stacked"
      title={count ? `${title} · ${count}` : title}
      description={description}
      action={
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          <Plus /> <span className="max-sm:sr-only">{addLabel}</span>
        </Button>
      }
    >
      {children}
      {count === 0 && <p className="text-sm text-muted-foreground">{empty}</p>}
    </SettingsSection>
  )
}

/** The parts that belong to every printer of a print type, one printer model, or one custom printer, which a part added here joins. */
function PartGroup({ group, onAdd, children }: { group: LabelledGroup; onAdd: () => void; children: ReactNode }) {
  const copy = useI18n().t.settings.consumables.parts
  const preset = getPrinterPreset(group.printerPresetId)
  const leftFleet = (group.printerPresetId !== undefined || group.printerId !== undefined) && group.printers === 0
  return (
    <section aria-label={group.label} className="grid min-w-0 gap-1.5">
      <div className="flex min-w-0 items-center gap-3">
        <PrinterPresetImage printer={preset ?? { printType: group.printType }} className="size-9" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{group.label}</h3>
          <p className="truncate text-xs text-muted-foreground">
            {leftFleet ? copy.leftFleet : group.printerId ? copy.customPrinter : copy.printers(group.printers)}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" aria-label={copy.addTo(group.label)} onClick={onAdd}>
          <Plus /> <span className="max-sm:sr-only">{copy.add}</span>
        </Button>
      </div>
      {children && <div className="min-w-0 sm:pl-12">{children}</div>}
    </section>
  )
}

/** One consumable as a line: what it is, what the catalogue says of it, its stock and price; it opens its dialog. */
function ConsumableRow({
  consumable,
  nested = false,
  preset,
  level,
  money,
  rate,
  onOpen,
}: {
  consumable: Consumable
  /** Listed under its product's line, so it reads as its colour alone. */
  nested?: boolean
  /** The catalogue product a resin or filament is. */
  preset?: ResinPreset | FilamentPreset
  level?: StockLevel
  money: (value: number) => string
  rate: (value: number) => string
  onOpen: () => void
}) {
  const { t, locale } = useI18n()
  const copy = t.settings.consumables
  const facts = nested ? undefined : rowFacts(consumable)
  const name = (nested && consumable.kind === 'filament' && consumable.colour?.name) || consumable.name
  const price = consumablePrice(consumable)
  const priced =
    consumable.kind === 'resin'
      ? `${money(price)}/L`
      : consumable.kind === 'filament'
        ? `${money(price)}/kg`
        : consumable.kind === 'supply'
          ? `${money(price)}${copy.supplies.perUnit[consumable.unit]}`
          : money(price)
  const figures = (
    <>
      <StockSummary consumable={consumable} level={level} />
      <span className="@sm:min-w-24 @sm:text-right">{priced}</span>
    </>
  )

  function rowFacts(item: Consumable) {
    if (item.kind === 'resin') {
      return preset ? materialFacts(preset, locale) : `${formatNumber(item.densityGramsPerMl, locale)} g/mL`
    }
    if (item.kind === 'filament') {
      return preset ? materialFacts(preset, locale) : item.colour?.name
    }
    if (item.kind === 'supply') return copy.supplies.units[item.unit]
    const cost =
      item.lifespanUnit === 'plates' ? copy.parts.perPlate(rate(partCostPerPlate(item))) : copy.parts.perHour(rate(partCostPerHour(item)))
    return [copy.parts.lasts(formatNumber(item.lifespan, locale), copy.parts.units[item.lifespanUnit]), cost].join(' · ')
  }

  return (
    <button
      type="button"
      aria-label={copy.edit(consumable.name)}
      className={cn(rowClassName, nested && 'bg-muted/20 pl-8 @sm:pl-14')}
      onClick={onOpen}
    >
      <ConsumableIcon consumable={consumable} className={cn(nested && 'size-8')} />
      <span className="min-w-0 flex-1">
        <span className="block font-medium @max-sm:line-clamp-2 @sm:truncate">{name}</span>
        {facts && <span className="block truncate text-xs text-muted-foreground">{facts}</span>}
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-xs text-muted-foreground *:whitespace-nowrap @sm:hidden">
          {figures}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-4 font-mono text-xs text-muted-foreground @max-sm:hidden">{figures}</span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  )
}

const rowClassName =
  'flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset'

/** A catalogue filament stocked in several colours as one line: its swatches, how many run low, and its price or range. */
function FilamentProductRow({
  entry,
  preset,
  levels,
  money,
  onToggle,
}: {
  entry: ProductEntry
  preset?: FilamentPreset
  levels: StockLevel[]
  money: (value: number) => string
  onToggle: () => void
}) {
  const { t, locale } = useI18n()
  const copy = t.settings.consumables
  const name = preset ? filamentConsumableName(preset) : entry.filaments[0].name
  const prices = entry.filaments.map(({ pricePerKg }) => pricePerKg)
  const [lowest, highest] = [Math.min(...prices), Math.max(...prices)]
  const priced = lowest === highest ? `${money(lowest)}/kg` : `${money(lowest)}–${money(highest)}/kg`
  const low = levels.filter((level) => level.low || level.missing).length
  const swatches = entry.filaments.flatMap(({ id, colour }) => (colour ? [{ id, hex: colour.hex }] : []))
  const Chevron = entry.open ? ChevronDown : ChevronRight
  const figures = (
    <>
      {low > 0 && (
        <span className="inline-flex items-center gap-1.5">
          <LowMarker />
          {copy.stock.lowCount(low)}
        </span>
      )}
      <span className="@sm:min-w-24 @sm:text-right">{priced}</span>
    </>
  )
  return (
    <button type="button" aria-expanded={entry.open} className={rowClassName} onClick={onToggle}>
      <ConsumableIcon consumable={{ kind: 'filament' }} />
      <span className="min-w-0 flex-1">
        <span className="block font-medium @max-sm:line-clamp-2 @sm:truncate">{name}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="flex shrink-0 -space-x-1" aria-hidden="true">
            {swatches.slice(0, PRODUCT_SWATCHES).map(({ id, hex }, index) => (
              <ColourSwatch
                key={id}
                hex={hex}
                className={cn('size-3.5 border-foreground/35 ring-1 ring-card', index >= NARROW_PRODUCT_SWATCHES && '@max-sm:hidden')}
              />
            ))}
          </span>
          <span className="truncate">
            {[copy.filaments.colourCount(entry.filaments.length), preset && materialFacts(preset, locale)].filter(Boolean).join(' · ')}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-xs text-muted-foreground *:whitespace-nowrap @sm:hidden">
          {figures}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-4 font-mono text-xs text-muted-foreground @max-sm:hidden">{figures}</span>
      <Chevron className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  )
}
