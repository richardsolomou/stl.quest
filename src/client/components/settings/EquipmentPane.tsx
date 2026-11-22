import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import type { Consumable } from '../../../core/consumables'
import {
  DEFAULT_MINUTES_PER_USE,
  defaultEquipmentStage,
  equipmentPrintType,
  kindPrintType,
  missingSupplies,
  type EquipmentItem,
  type EquipmentKind,
} from '../../../core/equipment'
import { equipmentFromPreset, equipmentPresetName, getEquipmentPreset, type EquipmentPreset } from '../../../core/equipmentPresets'
import { errorMessage } from '../../../core/error'
import type { PrintType } from '../../../core/types'
import { createId } from '../../id'
import { useI18n } from '../../i18n'
import { matchesListSearch, showsListSearch } from '../../listSearch'
import { consumablesQuery, equipmentQuery } from '../../queries'
import { useWorkspacePrintTypes, useWorkspaceSlug } from '../../workspace'
import { useInventory } from '../../inventory'
import { formatNumber } from '../priceCalculator/format'
import { QueryState } from '../QueryState'
import { SettingNotice } from '../SettingNotice'
import { EquipmentDialog } from './EquipmentDialog'
import { ArchivedInventory } from './ArchivedInventory'
import { EquipmentIcon } from './EquipmentIcon'
import { EquipmentPresetPicker } from './EquipmentPresetPicker'
import { PageHeader, SettingsPage, SettingsSection } from './SettingsLayout'
import { VirtualList } from './VirtualList'

// Sections are named for what the kit is; washing and curing share one because combos do both.
const EQUIPMENT_GROUPS = ['washCure', 'ultrasonic', 'oven', 'dryer', 'other'] as const
const EQUIPMENT_GROUP: Record<EquipmentKind, (typeof EQUIPMENT_GROUPS)[number]> = {
  wash: 'washCure',
  cure: 'washCure',
  'wash-cure': 'washCure',
  ultrasonic: 'ultrasonic',
  oven: 'oven',
  dryer: 'dryer',
  other: 'other',
}

function newCustomEquipment(printTypes: readonly PrintType[]): EquipmentItem {
  const kind = printTypes.includes('resin') ? 'wash' : 'dryer'
  return {
    id: createId(),
    name: '',
    kind,
    stage: defaultEquipmentStage(kind),
    printType: kindPrintType(kind),
    powerWatts: 0,
    minutesPerUse: DEFAULT_MINUTES_PER_USE[kind],
    supplies: [],
  }
}

/** Standalone kit used in the workflow, each stored straight away from its own dialog, as printers are. */
export function EquipmentPane() {
  const workspaceSlug = useWorkspaceSlug()
  const query = useQuery(equipmentQuery(workspaceSlug))
  const consumables = useQuery(consumablesQuery(workspaceSlug)).data?.consumables
  const { mutation, save, setArchived: storeArchived, remove } = useInventory('equipment')
  const { t } = useI18n()
  const copy = t.settings.equipment
  const printTypes = useWorkspacePrintTypes()
  const [search, setSearch] = useState('')
  // A custom item being added is kept here, not in the list, until its dialog has it named and saves it.
  const [editing, setEditing] = useState<EquipmentItem | null>(null)

  if (!query.data) {
    return (
      <QueryState
        loading={query.isPending}
        error={query.error}
        loadingLabel={copy.loading}
        errorTitle={copy.loadError}
        onRetry={() => void query.refetch()}
      />
    )
  }

  const items = query.data.equipment
  const setArchived = (id: string, archived: boolean) => void storeArchived(id, archived).catch(() => undefined)
  const closeEditor = () => {
    setEditing(null)
    // The dialog showed its own failure; the pane's notice is for changes made from the list.
    if (mutation.isError) mutation.reset()
  }
  // A catalogue item is complete as picked, so it is stored straight away; a custom one waits in its dialog for a name.
  const addPreset = (preset: EquipmentPreset) => {
    const item = equipmentFromPreset(createId(), preset)
    void save(item).then(
      () => setEditing(item),
      () => undefined,
    )
  }
  const addCustom = () => setEditing(newCustomEquipment(printTypes))

  const active = items.filter((item) => !item.archived)
  const archived = items.filter((item) => item.archived)
  const added = new Set(active.flatMap((item) => (item.presetId ? [item.presetId] : [])))
  const found = active.filter((item) => {
    const preset = getEquipmentPreset(item.presetId ?? '')
    return matchesListSearch(search, [item.name, preset && equipmentPresetName(preset), copy.kinds[item.kind]])
  })
  const failure = mutation.error ? errorMessage(mutation.error, copy.tryAgainFallback) : undefined

  return (
    <SettingsPage data-saving={mutation.isPending}>
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={
          active.length > 0 && (
            <EquipmentPresetPicker
              variant="default"
              added={added}
              disabled={mutation.isPending}
              onSelect={addPreset}
              onCustom={addCustom}
            />
          )
        }
      />

      {active.length === 0 ? (
        <SettingsSection layout="stacked">
          <div className="flex items-start gap-3 max-sm:flex-col">
            <EquipmentIcon kind="wash-cure" className="size-12 bg-muted text-foreground" />
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div className="flex flex-col gap-1">
                <h2 className="font-medium">{copy.empty.title}</h2>
                <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{copy.empty.description}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <EquipmentPresetPicker
                  variant="default"
                  label={copy.empty.catalogue}
                  added={added}
                  disabled={mutation.isPending}
                  onSelect={addPreset}
                  onCustom={addCustom}
                />
                <Button type="button" variant="ghost" disabled={mutation.isPending} onClick={addCustom}>
                  {copy.empty.custom}
                </Button>
              </div>
            </div>
          </div>
        </SettingsSection>
      ) : (
        <>
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
          {search.trim() !== '' && found.length === 0 && <p className="text-sm text-muted-foreground">{copy.noMatches(search.trim())}</p>}
          {EQUIPMENT_GROUPS.filter((group) => active.some((item) => EQUIPMENT_GROUP[item.kind] === group)).map((group) => {
            const shown = found.filter((item) => EQUIPMENT_GROUP[item.kind] === group)
            return (
              <SettingsSection
                key={group}
                layout="stacked"
                title={`${copy.groups[group]} · ${active.filter((item) => EQUIPMENT_GROUP[item.kind] === group).length}`}
              >
                {shown.length > 0 && (
                  <VirtualList
                    items={shown}
                    getKey={({ id }) => id}
                    renderItem={(item) => <EquipmentRow item={item} consumables={consumables} onOpen={() => setEditing(item)} />}
                  />
                )}
              </SettingsSection>
            )
          })}
        </>
      )}

      <ArchivedInventory
        kind="equipment"
        title={copy.archived.title}
        description={copy.archived.description}
        restoreLabel={copy.archived.restore}
        items={archived.map((item) => ({ id: item.id, name: item.name, detail: copy.kinds[item.kind] }))}
        pending={mutation.isPending}
        onRestore={(id) => setArchived(id, false)}
        onDelete={remove}
      />

      <SettingNotice notice={failure ? { tone: 'error', title: copy.notSaved, hint: copy.notSavedHint, detail: failure } : undefined} />

      {editing && (
        <EquipmentDialog
          key={editing.id}
          item={editing}
          isNew={!items.some(({ id }) => id === editing.id)}
          onSave={save}
          onArchive={() => {
            setArchived(editing.id, true)
            closeEditor()
          }}
          onClose={closeEditor}
        />
      )}
    </SettingsPage>
  )
}

function EquipmentRow({ item, consumables, onOpen }: { item: EquipmentItem; consumables?: Consumable[]; onOpen: () => void }) {
  const { t, locale } = useI18n()
  const copy = t.settings.equipment
  const preset = getEquipmentPreset(item.presetId ?? '')
  const modelName = preset && equipmentPresetName(preset)
  const model = modelName && modelName.toLocaleLowerCase() !== item.name.trim().toLocaleLowerCase() ? modelName : undefined
  const serves = copy.printTypes[equipmentPrintType(item) ?? 'both']
  const run = [copy.watts(formatNumber(item.powerWatts, locale)), copy.minutes(formatNumber(item.minutesPerUse, locale))].join(' · ')
  const missing = consumables ? missingSupplies(item, consumables).length : 0
  const supplyNames = item.supplies.flatMap(
    (supply) => consumables?.find((consumable) => consumable.id === supply.consumableId)?.name ?? [],
  )
  const supplies = !item.supplies.length
    ? copy.noSupplies
    : supplyNames.length === 1 && item.supplies.length === 1
      ? supplyNames[0]
      : copy.supplies(item.supplies.length)

  return (
    <button
      type="button"
      aria-label={copy.row.open(item.name)}
      className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset"
      onClick={onOpen}
    >
      <EquipmentIcon kind={item.kind} image={preset?.image} />
      <span className="min-w-0 flex-1">
        <span className="block font-medium @max-sm:line-clamp-2 @sm:truncate">{item.name}</span>
        <span className="block text-xs text-muted-foreground @max-sm:line-clamp-2 @sm:truncate">
          {[model ?? copy.kinds[item.kind], serves].join(' · ')}
        </span>
        <span className="block truncate text-xs text-muted-foreground @2xl:hidden">{[run, supplies].join(' · ')}</span>
      </span>
      <span className="w-40 shrink-0 text-sm text-muted-foreground tabular-nums @max-2xl:hidden">{run}</span>
      <span className="w-36 shrink-0 truncate text-sm text-muted-foreground @max-2xl:hidden">{supplies}</span>
      {missing > 0 && (
        <Badge variant="destructive" className="shrink-0">
          {copy.missing(missing)}
        </Badge>
      )}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  )
}
