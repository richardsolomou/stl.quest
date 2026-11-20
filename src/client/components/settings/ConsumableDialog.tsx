import { useRef, useState, type ReactNode, type Ref } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Replace, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  consumablePrice,
  consumableUnit,
  missingConsumableFields,
  partCostPerHour,
  partCostPerPlate,
  SUPPLY_UNITS,
  withConsumablePrice,
  type Consumable,
  type FilamentColour,
  type FilamentConsumable,
  type PartConsumable,
  type ResinConsumable,
} from '../../../core/consumables'
import { filamentConsumableName, type FilamentPreset } from '../../../core/filamentPresets'
import { partPresetUnitPrice } from '../../../core/partPresets'
import { findPreset } from '../../../core/presets'
import { getPrinterPreset } from '../../../core/printerPresets'
import { resinPresetName, type ResinPreset } from '../../../core/resinPresets'
import { enteredUnitScale, packSize } from '../../../core/stock'
import type { Messages } from '../../../core/i18n'
import type { PrinterProfile } from '../../../core/types'
import type { StockLevel } from '../../../core/usage'
import { useI18n } from '../../i18n'
import { matchesListSearch } from '../../listSearch'
import { catalogueQuery } from '../../queries'
import { useAutosave } from '../../useAutosave'
import { useUsageTracking } from '../../workspace'
import { AutosaveStatus } from '../AutosaveStatus'
import { ColourSwatch } from '../ColourSwatch'
import { DialogShell } from '../DialogShell'
import { formatNumber } from '../priceCalculator/format'
import { StockPanel } from './ConsumableStock'
import { ConsumableIcon } from './ConsumableIcon'
import { materialFacts, MaterialPicker } from './ConsumablePicker'
import { PrinterPresetImage } from './PrinterPresetImage'

// Past this many colours, scanning swatches by eye gets slow, so the picker offers a search.
const SEARCHABLE_COLOURS = 24

/**
 * Everything about one consumable, saved as it is edited. A catalogue product reads as text with Change, and only what
 * the user owns is a field; a new one is created once nothing it needs is missing, and its stock shows once it is.
 */
export function ConsumableDialog({
  consumable,
  isNew,
  workspaceSlug,
  level,
  printers,
  symbol,
  money,
  onSave,
  onRemove,
  onClose,
}: {
  consumable: Consumable
  isNew: boolean
  workspaceSlug: string
  level?: StockLevel
  printers: PrinterProfile[]
  symbol: string
  money: (value: number) => string
  onSave: (consumable: Consumable) => Promise<void>
  onRemove: () => void
  onClose: () => void
}) {
  const { t, locale } = useI18n()
  const copy = t.settings.consumables
  const tracking = useUsageTracking()
  const [draft, setDraft] = useState(consumable)
  const missing = missingConsumableFields(draft)
  const autosave = useAutosave({ value: draft, valid: missing.length === 0, save: onSave })
  const close = async () => {
    if (await autosave.flush()) onClose()
  }
  const remove = async () => {
    if (await autosave.flush()) onRemove()
  }
  const resins = useQuery({ ...catalogueQuery('resins'), enabled: draft.kind === 'resin' }).data
  const filaments = useQuery({ ...catalogueQuery('filaments'), enabled: draft.kind === 'filament' }).data
  const parts = useQuery({ ...catalogueQuery('parts'), enabled: draft.kind === 'part' }).data
  const preset =
    draft.kind === 'resin'
      ? findPreset(resins, draft.resinPresetId)
      : draft.kind === 'filament'
        ? findPreset(filaments, draft.filamentPresetId)
        : draft.kind === 'part'
          ? findPreset(parts, draft.partPresetId)
          : undefined
  // A new item opens on what it needs first: its name when it is the user's own, else its price, unless a catalogue
  // filament's colour is still to be picked. An existing one opens without raising a phone's keyboard.
  const nameField = useRef<HTMLInputElement>(null)
  const priceField = useRef<HTMLInputElement>(null)
  const picksColour = draft.kind === 'filament' && !draft.colour && Boolean(findPreset(filaments, draft.filamentPresetId)?.colors?.length)
  const [initialFocus] = useState(() => (!isNew || picksColour ? undefined : preset ? priceField : nameField))
  const needs = new Intl.ListFormat(locale, { type: 'conjunction' }).format(missing.map((field) => copy.dialog.fields[field]))

  return (
    <DialogShell
      onClose={() => void close()}
      title={draft.name.trim() || copy.dialog.newTitle[draft.kind]}
      status={
        missing.length ? (
          <span className="text-right text-xs text-muted-foreground">{copy.dialog.needs(needs)}</span>
        ) : (
          <AutosaveStatus status={autosave.status} onRetry={() => void autosave.retry()} />
        )
      }
      initialFocus={initialFocus}
      focusDialog={!initialFocus}
      contentClassName="space-y-5"
      footer={
        <>
          {!isNew && (
            <Button
              type="button"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive sm:mr-auto"
              onClick={() => void remove()}
            >
              {t.common.remove}
            </Button>
          )}
          <Button type="button" onClick={() => void close()}>
            {t.common.done}
          </Button>
        </>
      }
    >
      {draft.kind === 'resin' && <ResinProduct resin={draft} onChange={setDraft} />}
      {draft.kind === 'filament' && <FilamentProduct filament={draft} onChange={setDraft} />}
      {draft.kind === 'part' && <PartProduct part={draft} printers={printers} />}
      {!preset && (
        <Field>
          <FieldLabel htmlFor="consumable-name">{copy.name}</FieldLabel>
          <Input
            id="consumable-name"
            ref={nameField}
            value={draft.name}
            maxLength={120}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </Field>
      )}
      {draft.kind === 'filament' && (
        <FilamentColourField filament={draft} onChange={setDraft} onPicked={() => priceField.current?.focus()} />
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        {draft.kind === 'supply' && (
          <UnitField
            id="consumable-unit"
            label={copy.supplies.unit}
            value={draft.unit}
            options={SUPPLY_UNITS.map((value) => ({ value, label: copy.supplies.units[value] }))}
            onChange={(unit) => setDraft({ ...draft, unit })}
          />
        )}
        <AmountField
          id="consumable-price"
          inputRef={priceField}
          // A part's list-price hint needs the width.
          className={draft.kind === 'part' ? 'sm:col-span-2' : undefined}
          label={priceLabel(draft, symbol, copy)}
          value={consumablePrice(draft)}
          min={draft.kind === 'resin' || draft.kind === 'filament' ? 0.01 : 0}
          description={draft.kind === 'part' && <ListPriceHint partPresetId={draft.partPresetId} />}
          onChange={(price) => setDraft(withConsumablePrice(draft, price))}
        />
        {draft.kind === 'resin' && !findPreset(resins, draft.resinPresetId)?.densityGramsPerMl && (
          <AmountField
            id="consumable-density"
            label={copy.resins.density}
            value={draft.densityGramsPerMl}
            min={0.01}
            description={copy.dialog.densityHint}
            onChange={(densityGramsPerMl) => setDraft({ ...draft, densityGramsPerMl })}
          />
        )}
        {draft.kind === 'part' && !draft.partPresetId && <CustomPartFields part={draft} money={money} onChange={setDraft} />}
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <StockFields consumable={draft} tracking={tracking} onChange={setDraft} />
      </div>
      {!isNew && tracking && <StockPanel workspaceSlug={workspaceSlug} consumable={draft} level={level} printers={printers} />}
    </DialogShell>
  )
}

function priceLabel(consumable: Consumable, symbol: string, copy: Messages['settings']['consumables']) {
  if (consumable.kind === 'resin') return copy.resins.price(symbol)
  if (consumable.kind === 'filament') return copy.filaments.price(symbol)
  if (consumable.kind === 'supply') return copy.supplies.price(symbol, consumable.unit)
  return copy.parts.price(symbol)
}

/** The catalogue product as a card with what the catalogue knows and Change, or the user's own with a way back to it. */
function ProductCard({ kind, name, facts, onChange }: { kind: 'resin' | 'filament'; name?: string; facts?: string; onChange: () => void }) {
  const copy = useI18n().t.settings.consumables
  return (
    <section className="grid gap-2" aria-labelledby="consumable-product">
      <h3 id="consumable-product" className="text-sm font-medium">
        {copy.dialog.product}
      </h3>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/20 p-2.5">
        <ConsumableIcon consumable={{ kind }} className="size-12" />
        <div className="min-w-0 flex-1 basis-40">
          <p className="font-medium [overflow-wrap:anywhere]">{name ?? copy.picker.custom[kind]}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">{name ? facts : copy.dialog.customHint}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onChange}>
          <Replace /> {name ? copy.dialog.changeProduct : copy.dialog.chooseProduct}
        </Button>
      </div>
    </section>
  )
}

function ResinProduct({ resin, onChange }: { resin: ResinConsumable; onChange: (resin: ResinConsumable) => void }) {
  const { locale } = useI18n()
  const [changing, setChanging] = useState(false)
  const resins = useQuery(catalogueQuery('resins')).data
  const preset = findPreset(resins, resin.resinPresetId)
  const choose = (next: ResinPreset) =>
    onChange({
      ...resin,
      resinPresetId: next.id,
      name: resinPresetName(next),
      densityGramsPerMl: next.densityGramsPerMl ?? resin.densityGramsPerMl,
    })
  return (
    <>
      <ProductCard
        kind="resin"
        name={preset && resinPresetName(preset)}
        facts={preset && materialFacts(preset, locale)}
        onChange={() => setChanging(true)}
      />
      {changing && (
        <MaterialPicker
          kind="resin"
          presets={resins}
          mode="change"
          current={resin.resinPresetId}
          onSelect={choose}
          onCustom={() => onChange({ ...resin, resinPresetId: undefined })}
          onClose={() => setChanging(false)}
        />
      )}
    </>
  )
}

function FilamentProduct({ filament, onChange }: { filament: FilamentConsumable; onChange: (filament: FilamentConsumable) => void }) {
  const { locale } = useI18n()
  const [changing, setChanging] = useState(false)
  const filaments = useQuery(catalogueQuery('filaments')).data
  const preset = findPreset(filaments, filament.filamentPresetId)
  const choose = (next: FilamentPreset) =>
    onChange({ ...filament, filamentPresetId: next.id, name: filamentConsumableName(next), colour: undefined })
  return (
    <>
      <ProductCard
        kind="filament"
        name={preset && `${preset.brand} ${preset.name}`}
        facts={preset && materialFacts(preset, locale)}
        onChange={() => setChanging(true)}
      />
      {changing && (
        <MaterialPicker
          kind="filament"
          presets={filaments}
          mode="change"
          current={filament.filamentPresetId}
          onSelect={choose}
          onCustom={() => onChange({ ...filament, filamentPresetId: undefined })}
          onClose={() => setChanging(false)}
        />
      )}
    </>
  )
}

/** A catalogue filament's colour is picked from the swatches once, then reads as its swatch with Change. */
function FilamentColourField({
  filament,
  onChange,
  onPicked,
}: {
  filament: FilamentConsumable
  onChange: (filament: FilamentConsumable) => void
  /** Called once a catalogue swatch settles the colour, so the price can be entered next. */
  onPicked: () => void
}) {
  const copy = useI18n().t.settings.consumables
  const [changing, setChanging] = useState(false)
  const preset = findPreset(useQuery(catalogueQuery('filaments')).data, filament.filamentPresetId)
  const colour = preset && !changing ? filament.colour : undefined
  if (colour) {
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-medium">{copy.filaments.colour}</span>
        <ColourSwatch hex={colour.hex} className="size-4" />
        <span>{colour.name}</span>
        <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={() => setChanging(true)}>
          {copy.dialog.changeProduct}
        </Button>
      </p>
    )
  }
  return (
    <ColourField
      key={preset?.id}
      preset={preset}
      colour={filament.colour}
      onPicked={() => {
        setChanging(false)
        onPicked()
      }}
      onChange={(next) => onChange({ ...filament, colour: next, name: preset ? filamentConsumableName(preset, next) : filament.name })}
    />
  )
}

/** A wear part reads as what it fits, and for a catalogue part how long it lasts and on what basis. */
function PartProduct({ part, printers }: { part: PartConsumable; printers: PrinterProfile[] }) {
  const { t, locale } = useI18n()
  const copy = t.settings.consumables
  const preset = findPreset(useQuery(catalogueQuery('parts')).data, part.partPresetId)
  const printer = getPrinterPreset(part.printerPresetId)
  const own = part.printerId && (printers.find(({ id }) => id === part.printerId)?.name ?? copy.parts.removedPrinter)
  const fits = own || (printer ? `${printer.brand} ${printer.model}` : copy.parts.every[part.printType])
  const facts = preset && [
    fits,
    copy.parts.lasts(formatNumber(part.lifespan, locale), copy.parts.units[part.lifespanUnit]),
    part.lifespan === preset.lifespan && part.lifespanUnit === preset.lifespanUnit && copy.parts.basis[preset.lifespanSource.basis],
  ]
  return (
    <section className="grid gap-2" aria-labelledby="consumable-product">
      <h3 id="consumable-product" className="text-sm font-medium">
        {copy.dialog.part}
      </h3>
      <div className="flex items-center gap-3 rounded-lg border bg-muted/20 p-2.5">
        <PrinterPresetImage printer={printer ?? { printType: part.printType }} className="size-12 rounded-md border bg-muted/40" />
        <div className="min-w-0 flex-1">
          <p className="font-medium [overflow-wrap:anywhere]">{preset ? part.name : copy.picker.custom.part}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {facts ? facts.filter(Boolean).join(' · ') : own ? copy.dialog.fitsPrinter(own) : copy.dialog.fits(fits)}
          </p>
        </div>
      </div>
    </section>
  )
}

/** How long a part of the user's own lasts, and in what, which the catalogue would otherwise know. */
function CustomPartFields({
  part,
  money,
  onChange,
}: {
  part: PartConsumable
  money: (value: number) => string
  onChange: (part: PartConsumable) => void
}) {
  const copy = useI18n().t.settings.consumables.parts
  const cost = part.lifespanUnit === 'plates' ? copy.perPlate(money(partCostPerPlate(part))) : copy.perHour(money(partCostPerHour(part)))
  return (
    <>
      <AmountField
        id="consumable-lifespan"
        label={copy.lifespan}
        value={part.lifespan}
        min={1}
        description={part.lifespan > 0 && part.price >= 0 ? cost : undefined}
        onChange={(lifespan) => onChange({ ...part, lifespan })}
      />
      <UnitField
        id="consumable-lifespan-unit"
        label={copy.lifespanUnit}
        value={part.lifespanUnit}
        options={(['plates', 'hours'] as const).map((value) => ({ value, label: copy.units[value] }))}
        onChange={(lifespanUnit) => onChange({ ...part, lifespanUnit })}
      />
    </>
  )
}

/** A number the user enters, empty until they do (NaN), so nothing is made up for them. */
function AmountField({
  id,
  label,
  value,
  min,
  description,
  inputRef,
  className,
  onChange,
}: {
  id: string
  label: string
  value: number
  min: number
  description?: ReactNode
  inputRef?: Ref<HTMLInputElement>
  className?: string
  onChange: (value: number) => void
}) {
  return (
    <Field className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        ref={inputRef}
        type="number"
        inputMode="decimal"
        min={min}
        step="any"
        className="tabular-nums"
        value={Number.isFinite(value) ? value : ''}
        onChange={(event) => onChange(event.target.valueAsNumber)}
      />
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  )
}

function UnitField<Value extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string
  label: string
  value: Value
  options: { value: Value; label: string }[]
  onChange: (value: Value) => void
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select items={options} value={value} onValueChange={(next) => next && onChange(next)}>
        <SelectTrigger className="w-full" id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

/** The catalogue's dated list price for a part added from it: a hint for the user's own price, never stored as it. */
function ListPriceHint({ partPresetId }: { partPresetId?: string }) {
  const { t, locale } = useI18n()
  const copy = t.settings.consumables
  const preset = findPreset(useQuery(catalogueQuery('parts')).data, partPresetId)
  const listed = preset?.listPrice
  if (!preset || !listed) return null
  const money = (amount: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: listed.currency }).format(amount)
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(listed.checked))
  const pack = listed.packSize ?? 1
  return (
    <>
      {pack > 1
        ? copy.listPackPrice(preset.brand, pack, money(listed.amount), money(partPresetUnitPrice(preset) ?? 0), date)
        : copy.listPrice(preset.brand, money(listed.amount), date)}{' '}
      {copy.listPriceHint}{' '}
      <a href={listed.url} target="_blank" rel="noreferrer" className="font-medium text-foreground underline underline-offset-2">
        {copy.listPriceSource}
      </a>
    </>
  )
}

/**
 * How much one pack holds, which quotes price a pack from, and while stock is tracked how little may be left before it
 * counts as running low. Both are entered in litres, kilograms, or items and kept in the consumable's own unit.
 */
function StockFields<Item extends Consumable>({
  consumable,
  tracking,
  onChange,
}: {
  consumable: Item
  tracking: boolean
  onChange: (consumable: Item) => void
}) {
  const copy = useI18n().t.settings.consumables
  const unit = consumableUnit(consumable)
  const scale = enteredUnitScale(unit)
  const unitLabel = copy.stockUnits[unit]
  const packLabel = consumable.kind === 'supply' ? copy.packSize.supply[consumable.unit] : copy.packSize[consumable.kind]
  const typicalPack = packSize({ ...consumable, packSize: undefined })
  const field = (key: 'minimumStock' | 'packSize', label: string, hint: string, placeholder?: number) => {
    const id = `consumable-${key}`
    const value = consumable[key]
    return (
      <Field>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          className="tabular-nums"
          value={value === undefined ? '' : Math.round((value / scale) * 1_000) / 1_000}
          placeholder={placeholder === undefined ? undefined : String(placeholder / scale)}
          onChange={(event) => {
            const entered = event.target.valueAsNumber
            onChange({ ...consumable, [key]: Number.isFinite(entered) && entered > 0 ? entered * scale : undefined })
          }}
        />
        <FieldDescription>{hint}</FieldDescription>
      </Field>
    )
  }
  return (
    <>
      {tracking && field('minimumStock', copy.minimumStock(unitLabel), copy.minimumStockHint)}
      {field('packSize', packLabel, copy.packSize.hint, typicalPack)}
    </>
  )
}

/** The catalogue's colours for the product as swatches, or a named colour of one's own when the catalogue has none or not this one. */
function ColourField({
  preset,
  colour,
  onPicked,
  onChange,
}: {
  preset?: FilamentPreset
  colour?: FilamentColour
  /** Called when a catalogue swatch is chosen, which settles the colour. */
  onPicked?: () => void
  onChange: (colour?: FilamentColour) => void
}) {
  const { t, locale } = useI18n()
  const copy = t.settings.consumables.filaments
  const swatches = (preset?.colors ?? []).map((option) => ({ hex: option.hex, name: option.names[locale] ?? option.names.en }))
  const sameHex = (swatch: FilamentColour) => colour !== undefined && swatch.hex.toLowerCase() === colour.hex.toLowerCase()
  const matched = swatches.find((swatch) => sameHex(swatch) && swatch.name === colour?.name) ?? swatches.find(sameHex)
  const [other, setOther] = useState(Boolean(colour && !matched))
  const [hex, setHex] = useState(colour?.hex ?? '#808080')
  const own = !swatches.length || other
  const [search, setSearch] = useState('')
  const shown = swatches.filter((swatch) => swatch === matched || matchesListSearch(search, [swatch.name]))
  return (
    <FieldSet className="gap-2">
      <FieldLegend variant="label" className="mb-0">
        {copy.colour}
        {matched && !other && <span className="font-normal text-muted-foreground"> · {matched.name}</span>}
      </FieldLegend>
      {swatches.length > SEARCHABLE_COLOURS && (
        <InputGroup className="max-w-60 bg-field">
          <InputGroupAddon>
            <Search aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            aria-label={copy.colourSearch}
            placeholder={copy.colourSearch}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </InputGroup>
      )}
      {search.trim() !== '' && shown.length === 0 && <p className="text-xs text-muted-foreground">{copy.colourNoMatches}</p>}
      {swatches.length > 0 && (
        <div className="flex flex-wrap items-center gap-0.5">
          {shown.map((swatch) => {
            const selected = !other && swatch === matched
            return (
              <button
                key={`${swatch.hex}-${swatch.name}`}
                type="button"
                aria-label={swatch.name}
                title={swatch.name}
                aria-pressed={selected}
                className={cn(
                  'grid size-7 cursor-pointer place-items-center rounded-full border-2 border-transparent transition-colors hover:border-foreground/30',
                  selected && 'border-foreground hover:border-foreground',
                )}
                onClick={() => {
                  setOther(false)
                  onChange(selected ? undefined : swatch)
                  if (!selected) onPicked?.()
                }}
              >
                <ColourSwatch hex={swatch.hex} className="size-5" />
              </button>
            )
          })}
          <button
            type="button"
            aria-pressed={other}
            className={cn(
              'ml-1 inline-flex h-7 cursor-pointer items-center rounded-full border border-dashed bg-background px-2.5 text-xs transition-colors hover:border-foreground/40',
              other && 'border-solid border-foreground bg-foreground text-background hover:border-foreground',
            )}
            onClick={() => {
              if (other) {
                setOther(false)
                onChange(undefined)
                return
              }
              setOther(true)
              if (matched) {
                setHex(matched.hex)
                onChange(undefined)
              }
            }}
          >
            {copy.otherColour}
          </button>
        </div>
      )}
      {own && (
        <div className="flex max-w-sm items-center gap-2">
          <input
            type="color"
            aria-label={copy.colourValue}
            className="h-8 w-10 shrink-0 cursor-pointer rounded-md border bg-field p-1"
            value={colour?.hex ?? hex}
            onChange={(event) => {
              setHex(event.target.value)
              if (colour) onChange({ ...colour, hex: event.target.value })
            }}
          />
          <Input
            aria-label={copy.colourName}
            placeholder={copy.colourName}
            value={colour?.name ?? ''}
            maxLength={60}
            onChange={(event) => onChange(event.target.value.trim() ? { name: event.target.value, hex: colour?.hex ?? hex } : undefined)}
          />
        </div>
      )}
      {!swatches.length && <FieldDescription>{copy.colourHint}</FieldDescription>}
    </FieldSet>
  )
}
