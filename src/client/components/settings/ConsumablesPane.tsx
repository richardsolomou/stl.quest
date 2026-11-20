import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Plus, RotateCcw, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import {
  consumablePrice,
  consumablesOfKind,
  partCostPerHour,
  partCostPerPlate,
  wearPartGroups,
  withConsumablePrice,
  type Consumable,
  type WearPartGroup,
} from '../../../core/consumables'
import { filamentFromPreset, type FilamentPreset } from '../../../core/filamentPresets'
import { genericPartPresets, partPresetsForPrinter, type PartPreset } from '../../../core/partPresets'
import { findPreset } from '../../../core/presets'
import { DEFAULT_PRICE_CALCULATOR_SETTINGS, TYPICAL_RESIN_DENSITY_GRAMS_PER_ML } from '../../../core/priceCalculator'
import { getPrinterPreset } from '../../../core/printerPresets'
import { printTypeCopy } from '../../../core/printTypes'
import { resinFromPreset, type ResinPreset } from '../../../core/resinPresets'
import { partFromPreset, type PartSuggestion } from '../../../core/stock'
import { PRINT_TYPES, type PrintType } from '../../../core/types'
import type { StockLevel } from '../../../core/usage'
import { useI18n } from '../../i18n'
import { useInventory } from '../../inventory'
import { activeItems } from '../../../core/inventory'
import { createId } from '../../id'
import { matchesListSearch, showsListSearch } from '../../listSearch'
import { catalogueQuery, consumablesQuery, priceCalculatorSettingsQuery, printersQuery, stockQuery } from '../../queries'
import { signalProductTourProgress } from '../../productTour'
import { useUsageTracking, useWorkspacePrintTypes, useWorkspaceSlug } from '../../workspace'
import { UsageTrackingInvite } from '../UsageTracking'
import { currencySymbol, formatMoney, formatNumber } from '../priceCalculator/format'
import { QueryState } from '../QueryState'
import { AlsoPrints } from './AlsoPrints'
import { ConsumableDialog } from './ConsumableDialog'
import { ConsumableIcon } from './ConsumableIcon'
import { materialFacts, MaterialPicker, PartPicker } from './ConsumablePicker'
import { StockSummary } from './ConsumableStock'
import { VirtualList } from './VirtualList'
import { PrinterPresetImage } from './PrinterPresetImage'
import { PageHeader, SettingsPage, SettingsSection } from './SettingsLayout'
import { SupplyNeeds } from './SupplyNeeds'

type LabelledGroup = WearPartGroup & { label: string }
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
  const profiles = useQuery(printersQuery(workspaceSlug)).data?.profiles
  const printers = useMemo(() => profiles ?? [], [profiles])
  const printTypes = useWorkspacePrintTypes()
  const tracking = useUsageTracking()
  const stock = useQuery({ ...stockQuery(workspaceSlug), enabled: tracking }).data?.stock
  const levels = useMemo(() => stock ?? [], [stock])
  const { mutation, save, setArchived } = useInventory('consumables')
  // A new item scrolls into view once it is stored, so it is found where it landed when its dialog closes.
  const [added, setAdded] = useState<string>()
  const saveItem = async (item: Consumable) => {
    const isNew = !saved.some(({ id }) => id === item.id)
    await save(item)
    if (isNew) setAdded(item.id)
    if (isNew && (item.kind === 'resin' || item.kind === 'filament')) signalProductTourProgress('stock')
  }
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
  const addCustomPart = (group: WearPartGroup) =>
    setEditing({
      id: createId(),
      kind: 'part',
      name: '',
      printType: group.printType,
      ...(group.printerPresetId && { printerPresetId: group.printerPresetId }),
      ...(group.printerId && { printerId: group.printerId }),
      price: Number.NaN,
      lifespan: Number.NaN,
      lifespanUnit: group.printType === 'resin' ? 'plates' : 'hours',
    })
  const addPart = (group: LabelledGroup) =>
    !partCatalogue || partPresets(partCatalogue, group).length ? setPicking({ kind: 'part', group }) : addCustomPart(group)
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
  const rows = (items: Consumable[]) =>
    items.length > 0 && (
      <VirtualList
        items={items}
        getKey={({ id }) => id}
        scrollToKey={added}
        renderItem={(consumable) => (
          <ConsumableRow
            consumable={consumable}
            preset={
              consumable.kind === 'resin'
                ? findPreset(resins, consumable.resinPresetId)
                : consumable.kind === 'filament'
                  ? findPreset(filaments, consumable.filamentPresetId)
                  : undefined
            }
            level={levels.find(({ consumableId }) => consumableId === consumable.id)}
            money={money}
            onOpen={() => setEditing(consumable)}
          />
        )}
      />
    )
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
          levels={levels}
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

      {archived.length > 0 && (
        <SettingsSection layout="stacked" title={copy.archived.title} description={copy.archived.description}>
          <div className="@container overflow-hidden rounded-lg border">
            <Table>
              <TableBody>
                {archived.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="w-full max-w-0">
                      <span className="block truncate font-medium" title={item.name}>
                        {item.name}
                      </span>
                      <span className="block text-xs text-muted-foreground">{kindTitles[item.kind]}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={mutation.isPending}
                        onClick={() => void setArchived(item.id, false).catch(failed)}
                      >
                        <RotateCcw />
                        <span className="@max-sm:sr-only">{copy.archived.restore}</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </SettingsSection>
      )}

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
          presets={partCatalogue && partPresets(partCatalogue, picking.group)}
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
          workspaceSlug={workspaceSlug}
          level={levels.find(({ consumableId }) => consumableId === editing.id)}
          printers={printers}
          symbol={symbol}
          money={money}
          onSave={saveItem}
          onArchive={() => archive(editing)}
          onClose={() => setEditing(null)}
        />
      )}
    </SettingsPage>
  )
}

/** The catalogue parts a wear-part group can add: its model's own, or those every printer of its type takes. */
function partPresets(parts: readonly PartPreset[], group: WearPartGroup) {
  return group.printerPresetId ? partPresetsForPrinter(parts, group.printerPresetId) : genericPartPresets(parts, group.printType)
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
  preset,
  level,
  money,
  onOpen,
}: {
  consumable: Consumable
  /** The catalogue product a resin or filament is. */
  preset?: ResinPreset | FilamentPreset
  level?: StockLevel
  money: (value: number) => string
  onOpen: () => void
}) {
  const { t, locale } = useI18n()
  const copy = t.settings.consumables
  const facts = rowFacts(consumable)
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
      item.lifespanUnit === 'plates' ? copy.parts.perPlate(money(partCostPerPlate(item))) : copy.parts.perHour(money(partCostPerHour(item)))
    return [copy.parts.lasts(formatNumber(item.lifespan, locale), copy.parts.units[item.lifespanUnit]), cost].join(' · ')
  }

  return (
    <button
      type="button"
      aria-label={copy.edit(consumable.name)}
      className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset"
      onClick={onOpen}
    >
      <ConsumableIcon consumable={consumable} />
      <span className="min-w-0 flex-1">
        <span className="block font-medium @max-sm:line-clamp-2 @sm:truncate">{consumable.name}</span>
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
