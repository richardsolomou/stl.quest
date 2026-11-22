import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { TriangleAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet, FieldTitle } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Consumable } from '../../../core/consumables'
import {
  defaultEquipmentStage,
  EQUIPMENT_KINDS,
  equipmentPrintType,
  kindPrintType,
  kindServesAny,
  EQUIPMENT_STAGES,
  supplyUnit,
  type EquipmentItem,
  type EquipmentKind,
} from '../../../core/equipment'
import { equipmentFromPreset, equipmentPresetName, getEquipmentPreset, type EquipmentPreset } from '../../../core/equipmentPresets'
import { DEFAULT_PRICE_CALCULATOR_SETTINGS } from '../../../core/priceCalculator'
import { PRINT_TYPES } from '../../../core/types'
import { useI18n } from '../../i18n'
import { consumablesQuery, priceCalculatorSettingsQuery } from '../../queries'
import { useAutosave } from '../../useAutosave'
import { useWorkspacePrintTypes, useWorkspaceSlug } from '../../workspace'
import { AutosaveStatus } from '../AutosaveStatus'
import { DialogShell } from '../DialogShell'
import { FilterCombobox } from '../FilterCombobox'
import { NumberInput } from '../priceCalculator/fields'
import { currencySymbol, formatNumber, formatRate } from '../priceCalculator/format'
import { EquipmentIcon } from './EquipmentIcon'
import { EquipmentPresetPicker } from './EquipmentPresetPicker'

const SERVES = [...PRINT_TYPES, 'both'] as const

/**
 * Everything about one piece of equipment, saved as it is edited; a new custom item is created once it has a name. A
 * catalogue item's name stays empty while it follows the model's.
 */
export function EquipmentDialog({
  item,
  isNew,
  onSave,
  onArchive,
  onClose,
}: {
  item: EquipmentItem
  isNew: boolean
  onSave: (item: EquipmentItem) => Promise<void>
  onArchive?: () => void
  onClose: () => void
}) {
  const { t, locale } = useI18n()
  const equipment = t.settings.equipment
  const copy = equipment.dialog
  const [initial] = useState(() => withFollowedName(item))
  const [draft, setDraft] = useState(initial)
  const preset = getEquipmentPreset(draft.presetId ?? '')
  const modelName = preset && equipmentPresetName(preset)
  const resolved: EquipmentItem = { ...draft, name: draft.name.trim() || modelName || '' }
  const autosave = useAutosave({ value: resolved, valid: !!resolved.name, save: onSave })
  // A new item starts without a name, which is not worth calling out until the dialog is edited.
  const touched = JSON.stringify(draft) !== JSON.stringify(initial)
  const nameError = (touched || !isNew) && !resolved.name ? copy.missingName : undefined
  const update = (patch: Partial<EquipmentItem>) => setDraft((current) => ({ ...current, ...patch }))
  const close = async () => {
    if (await autosave.flush()) onClose()
  }

  // The catalogue knows what a model is and draws, so those follow the model; what it serves follows only if it says.
  const choosePreset = (next: EquipmentPreset) =>
    setDraft((current) => {
      const facts = equipmentFromPreset(current.id, next)
      return {
        ...current,
        presetId: next.id,
        kind: facts.kind,
        stage: facts.stage,
        powerWatts: facts.powerWatts,
        printType: next.printType ?? current.printType,
      }
    })
  const makeCustom = () => setDraft((current) => ({ ...current, presetId: undefined, name: current.name.trim() || modelName || '' }))

  return (
    <DialogShell
      onClose={() => void close()}
      title={resolved.name || copy.newTitle}
      description={modelName && modelName !== resolved.name ? modelName : undefined}
      status={<AutosaveStatus status={autosave.status} onRetry={() => void autosave.retry()} />}
      contentClassName="space-y-5"
      footer={
        <>
          {!isNew && onArchive && (
            <Button type="button" variant="ghost" className="text-muted-foreground hover:text-destructive sm:mr-auto" onClick={onArchive}>
              {copy.archive}
            </Button>
          )}
          <Button type="button" onClick={() => void close()}>
            {t.common.done}
          </Button>
        </>
      }
    >
      <section className="grid gap-2" aria-labelledby="equipment-model">
        <h3 id="equipment-model" className="text-sm font-medium">
          {copy.model}
        </h3>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/20 p-2.5">
          <EquipmentIcon kind={draft.kind} image={preset?.image} className="size-14" />
          <div className="min-w-0 flex-1 basis-40">
            <p className="truncate font-medium">{modelName ?? copy.custom}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {preset
                ? [
                    equipment.kinds[draft.kind],
                    equipment.stages[draft.stage],
                    equipment.printTypes[equipmentPrintType(draft) ?? 'both'],
                    equipment.watts(formatNumber(draft.powerWatts, locale)),
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : copy.customHint}
            </p>
          </div>
          <EquipmentPresetPicker mode="change" current={draft.presetId} onSelect={choosePreset} onCustom={makeCustom} />
        </div>
      </section>

      <Field data-invalid={!!nameError || undefined}>
        <FieldLabel htmlFor="equipment-name">{copy.name}</FieldLabel>
        <Input
          id="equipment-name"
          value={draft.name}
          placeholder={modelName ?? copy.namePlaceholder}
          maxLength={120}
          aria-invalid={!!nameError || undefined}
          onChange={(event) => update({ name: event.target.value })}
        />
        {nameError ? (
          <FieldError>{nameError}</FieldError>
        ) : (
          <FieldDescription>{preset ? copy.nameHint : copy.customNameHint}</FieldDescription>
        )}
      </Field>

      <WorkflowFields draft={draft} preset={preset} onChange={update} />
      <RunFields draft={draft} preset={preset} onChange={update} />
      <WearFields draft={draft} onChange={update} />
      <SupplyFields supplies={draft.supplies} onChange={(supplies) => update({ supplies })} />
    </DialogShell>
  )
}

/**
 * What the item is, where it runs, and what it serves. A catalogue model fixes the kind and stage, and most kinds fix
 * what they serve, so only an oven, cleaner, or other kit the catalogue leaves open asks.
 */
function WorkflowFields({
  draft,
  preset,
  onChange,
}: {
  draft: EquipmentItem
  preset?: EquipmentPreset
  onChange: (patch: Partial<EquipmentItem>) => void
}) {
  const { t } = useI18n()
  const copy = t.settings.equipment
  const printTypes = useWorkspacePrintTypes()
  const kinds = EQUIPMENT_KINDS.filter((kind) => kind === draft.kind || kindServesAny(kind, printTypes)).map((value) => ({
    value,
    label: copy.kinds[value],
  }))
  // A new kind usually means a new stage too, such as a dryer before printing; the stage stays editable afterwards.
  const chooseKind = (kind: EquipmentKind) => onChange({ kind, stage: defaultEquipmentStage(kind) })
  const serves = (
    <Field>
      <FieldTitle aria-hidden="true">{copy.dialog.printType}</FieldTitle>
      <SegmentedControl
        legend={copy.dialog.printType}
        className="w-full"
        value={draft.printType ?? 'both'}
        options={SERVES.map((value) => ({ value, label: copy.printTypes[value] }))}
        onChange={(value) => onChange({ printType: value === 'both' ? undefined : value })}
      />
    </Field>
  )
  const fixed = kindPrintType(draft.kind)
  const asks = !fixed && !preset?.printType
  if (preset) return asks ? <div className="grid gap-5 sm:grid-cols-2">{serves}</div> : null
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Field>
        <FieldLabel htmlFor="equipment-kind">{copy.dialog.kind}</FieldLabel>
        <Select items={kinds} value={draft.kind} onValueChange={(kind) => kind && chooseKind(kind)}>
          <SelectTrigger className="w-full" id="equipment-kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {kinds.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {fixed && <FieldDescription>{copy.dialog.kindServes[fixed]}</FieldDescription>}
      </Field>
      {asks && serves}
      <Field className="sm:col-span-2">
        <FieldTitle aria-hidden="true">{copy.dialog.stage}</FieldTitle>
        <SegmentedControl
          legend={copy.dialog.stage}
          className="w-full sm:w-96"
          value={draft.stage}
          options={EQUIPMENT_STAGES.map((value) => ({ value, label: copy.stages[value] }))}
          onChange={(stage) => onChange({ stage })}
        />
        <FieldDescription>{copy.dialog.stageHint[draft.stage]}</FieldDescription>
      </Field>
    </div>
  )
}

/** How long a run takes, and for custom equipment what it draws, which a catalogue model supplies. */
function RunFields({
  draft,
  preset,
  onChange,
}: {
  draft: EquipmentItem
  preset?: EquipmentPreset
  onChange: (patch: Partial<EquipmentItem>) => void
}) {
  const copy = useI18n().t.settings.equipment.dialog
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {!preset && (
        <Field>
          <FieldLabel htmlFor="equipment-power">{copy.power}</FieldLabel>
          <NumberInput
            id="equipment-power"
            min={0}
            className="tabular-nums"
            value={draft.powerWatts}
            onChange={(powerWatts) => onChange({ powerWatts: Math.max(0, powerWatts) })}
          />
        </Field>
      )}
      <Field>
        <FieldLabel htmlFor="equipment-minutes">{copy.minutesPerUse}</FieldLabel>
        <NumberInput
          id="equipment-minutes"
          min={0}
          className="tabular-nums"
          value={draft.minutesPerUse}
          onChange={(minutesPerUse) => onChange({ minutesPerUse: Math.max(0, minutesPerUse) })}
        />
        <FieldDescription>{copy.minutesHint}</FieldDescription>
      </Field>
    </div>
  )
}

/** Supplies point at consumables by ID; one the library has lost stays listed, flagged, until it is removed here. */
function SupplyFields({
  supplies,
  onChange,
}: {
  supplies: EquipmentItem['supplies']
  onChange: (supplies: EquipmentItem['supplies']) => void
}) {
  const { t } = useI18n()
  const copy = t.settings.equipment.dialog
  const workspaceSlug = useWorkspaceSlug()
  const consumables = useQuery(consumablesQuery(workspaceSlug)).data?.consumables
  const byId = new Map((consumables ?? []).map((consumable) => [consumable.id, consumable]))
  const listed = new Set(supplies.map((supply) => supply.consumableId))
  const library = t.settings.consumables
  const kindLabels = {
    supply: library.supplies.title,
    part: library.parts.title,
    resin: library.resins.title,
    filament: library.filaments.title,
  }
  // Equipment mostly uses supplies such as IPA, so the library is offered in that order.
  const kindOrder = Object.keys(kindLabels)
  const options = (consumables ?? [])
    .filter((consumable) => !consumable.archived && !listed.has(consumable.id))
    .sort((a, b) => kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind))
    .map((consumable) => ({ value: consumable.id, label: consumable.name, kind: kindLabels[consumable.kind] }))
  const consumablesLink = (
    <Link to="/settings/$section" params={{ section: 'consumables' }} className="underline underline-offset-2">
      {copy.addToConsumables}
    </Link>
  )

  return (
    <FieldSet className="gap-2">
      <FieldLegend variant="label" className="mb-0">
        {copy.supplies}
      </FieldLegend>
      <FieldDescription className="-mt-1">{copy.suppliesHint}</FieldDescription>
      {supplies.length > 0 && (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {supplies.map((supply, index) => {
            const consumable = byId.get(supply.consumableId)
            return (
              <SupplyRow
                key={supply.consumableId}
                consumable={consumable}
                missing={!!consumables && !consumable}
                amount={supply.amountPerUse}
                onAmount={(amountPerUse) =>
                  onChange(supplies.map((candidate, at) => (at === index ? { ...candidate, amountPerUse } : candidate)))
                }
                onRemove={() => onChange(supplies.filter((_, at) => at !== index))}
              />
            )
          })}
        </ul>
      )}
      {consumables && consumables.every(({ archived }) => archived) ? (
        <p className="text-sm text-muted-foreground">
          {copy.noConsumables} {consumablesLink}.
        </p>
      ) : (
        <div className="grid gap-1.5">
          <FilterCombobox
            // Remounts after each pick so the search starts empty for the next supply.
            key={supplies.length}
            ariaLabel={copy.addSupply}
            placeholder={copy.addSupply}
            emptyLabel={copy.addSupplyEmpty}
            options={options}
            renderOption={(option) => (
              <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                <span className="truncate">{option.label}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{option.kind}</span>
              </span>
            )}
            optionAriaLabel={(option) => `${option.label}, ${option.kind}`}
            onChange={(consumableId) => consumableId && onChange([...supplies, { consumableId, amountPerUse: 1 }])}
          />
          <p className="text-xs text-muted-foreground">
            {copy.notInLibrary} {consumablesLink}.
          </p>
        </div>
      )}
    </FieldSet>
  )
}

function SupplyRow({
  consumable,
  missing,
  amount,
  onAmount,
  onRemove,
}: {
  consumable?: Consumable
  missing: boolean
  amount: number
  onAmount: (amount: number) => void
  onRemove: () => void
}) {
  const { t } = useI18n()
  const copy = t.settings.equipment.dialog
  const name = consumable?.name ?? copy.missingSupply
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
      <span className="min-w-0 flex-1 basis-40">
        <span className="flex min-w-0 items-center gap-1.5">
          {missing && <TriangleAlert className="size-4 shrink-0 text-destructive" aria-hidden="true" />}
          <span className={missing ? 'truncate text-sm text-destructive' : 'truncate text-sm font-medium'}>{name}</span>
        </span>
      </span>
      <InputGroup className="w-36 bg-field">
        <InputGroupInput
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          aria-label={copy.supplyAmount(name)}
          className="tabular-nums"
          defaultValue={amount}
          onChange={(event) => {
            if (Number.isFinite(event.target.valueAsNumber) && event.target.valueAsNumber > 0) onAmount(event.target.valueAsNumber)
          }}
        />
        {consumable && <InputGroupAddon align="inline-end">{copy.units[supplyUnit(consumable)]}</InputGroupAddon>}
      </InputGroup>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={copy.removeSupply(name)} onClick={onRemove}>
        <X />
      </Button>
    </li>
  )
}

function WearFields({ draft, onChange }: { draft: EquipmentItem; onChange: (patch: Partial<EquipmentItem>) => void }) {
  const { t, locale } = useI18n()
  const copy = t.settings.equipment.dialog
  const workspaceSlug = useWorkspaceSlug()
  const currency =
    useQuery(priceCalculatorSettingsQuery(workspaceSlug)).data?.settings.currency ?? DEFAULT_PRICE_CALCULATOR_SETTINGS.currency
  const perHour =
    draft.purchasePrice !== undefined && draft.lifespanHours
      ? formatRate(draft.purchasePrice / draft.lifespanHours, currency, locale)
      : undefined
  const optional = (value: string) => (value === '' || !Number.isFinite(Number(value)) ? undefined : Number(value))
  return (
    <FieldSet className="gap-2">
      <FieldLegend variant="label" className="mb-0">
        {copy.wear}
      </FieldLegend>
      <FieldDescription className="-mt-1">{copy.wearHint}</FieldDescription>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field className="gap-1">
          <FieldLabel htmlFor="equipment-price" className="text-xs text-muted-foreground">
            {copy.purchasePrice(currencySymbol(currency, locale))}
          </FieldLabel>
          <Input
            id="equipment-price"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            className="tabular-nums"
            value={draft.purchasePrice ?? ''}
            onChange={(event) => {
              const value = optional(event.target.value)
              onChange({ purchasePrice: value !== undefined && value >= 0 ? value : undefined })
            }}
          />
        </Field>
        <Field className="gap-1">
          <FieldLabel htmlFor="equipment-lifespan" className="text-xs text-muted-foreground">
            {copy.lifespanHours}
          </FieldLabel>
          <Input
            id="equipment-lifespan"
            type="number"
            inputMode="decimal"
            min={1}
            step="any"
            className="tabular-nums"
            value={draft.lifespanHours ?? ''}
            onChange={(event) => {
              const value = optional(event.target.value)
              onChange({ lifespanHours: value !== undefined && value > 0 ? value : undefined })
            }}
          />
        </Field>
      </div>
      {perHour && <p className="text-xs text-muted-foreground">{copy.perHour(perHour)}</p>}
    </FieldSet>
  )
}

/** Empties a catalogue item's name while it is the model's own, so the field shows it as the default it is. */
function withFollowedName(item: EquipmentItem): EquipmentItem {
  const preset = getEquipmentPreset(item.presetId ?? '')
  const follows = preset && item.name.trim().toLocaleLowerCase() === equipmentPresetName(preset).toLocaleLowerCase()
  return follows ? { ...item, name: '' } : item
}
