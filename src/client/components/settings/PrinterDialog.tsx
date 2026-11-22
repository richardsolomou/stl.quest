import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  useComboboxAnchor,
} from '@/components/ui/combobox'
import { Field, FieldDescription, FieldError, FieldLabel, FieldTitle } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/segmented-control'
import {
  DEFAULT_PRINTER_POWER_WATTS,
  equipmentPresetName,
  PRINTER_ADD_ON_PRESETS,
  printerPowerProfile,
  printingPower,
  type EquipmentPreset,
} from '../../../core/equipmentPresets'
import { printerWear, type PriceCalculatorCurrency } from '../../../core/priceCalculator'
import { getPrinterPreset, type PrinterPreset } from '../../../core/printerPresets'
import { normalizePrinterProfile, printerModelName, printerValidationError } from '../../../core/printers'
import { PRINT_TYPES, type PrinterProfile } from '../../../core/types'
import { useI18n } from '../../i18n'
import { useAutosave } from '../../useAutosave'
import { useUsageTracking } from '../../workspace'
import { AutosaveStatus } from '../AutosaveStatus'
import { DialogShell } from '../DialogShell'
import { currencySymbol, formatNumber, formatRate } from '../priceCalculator/format'
import { UsageTrackingInvite } from '../UsageTracking'
import { PrinterLifetimeLine, PrinterMaintenance } from './PrinterMaintenance'
import { PrinterPresetImage } from './PrinterPresetImage'
import { PrinterPresetPicker } from './PrinterPresetPicker'
import { SlicerField } from './SlicerField'
import { PurchaseDateField } from './PurchaseDate'

const DIMENSIONS = [
  ['widthMm', 'width'],
  ['depthMm', 'depth'],
  ['heightMm', 'height'],
] as const

/**
 * Everything about one printer, including what it costs to run, saved as it is edited; a new custom printer is created
 * once it has a name. Replacing its wear parts is logged at once.
 * A catalogue printer's name stays empty while it follows the model's name, so changing the model renames it too.
 */
export function PrinterDialog({
  printer,
  isNew,
  profiles,
  currency,
  stored = true,
  onSave,
  onRemove,
  onClose,
}: {
  printer: PrinterProfile
  isNew: boolean
  profiles: PrinterProfile[]
  currency: PriceCalculatorCurrency
  /** Whether `onSave` stores the printer, rather than keeping it for a later save, so the dialog can say it is saved. */
  stored?: boolean
  onSave: (profile: PrinterProfile) => Promise<void>
  onRemove?: () => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const copy = t.settings.printers.dialog
  const tracking = useUsageTracking()
  const [initial] = useState(() => withFollowedName(printer))
  const [draft, setDraft] = useState(initial)
  const preset = getPrinterPreset(draft.presetId)
  const modelName = preset && printerModelName(preset)
  const resolved = normalizePrinterProfile({ ...draft, name: draft.name.trim() || modelName || '' })
  const validation = printerValidationError(resolved, profiles, t)
  const autosave = useAutosave({ value: resolved, valid: !validation, save: onSave })
  // A new printer starts without a name, which is not worth calling out until the dialog is edited.
  const touched = JSON.stringify(draft) !== JSON.stringify(initial)
  const close = async () => {
    if (await autosave.flush()) onClose()
  }

  return (
    <DialogShell
      onClose={() => void close()}
      title={resolved.name || printer.name || copy.newTitle}
      description={modelName && modelName !== resolved.name ? modelName : undefined}
      status={stored && <AutosaveStatus status={autosave.status} onRetry={() => void autosave.retry()} />}
      contentClassName="space-y-5"
      footer={
        <>
          {!isNew && onRemove && (
            <Button type="button" variant="ghost" className="text-muted-foreground hover:text-destructive sm:mr-auto" onClick={onRemove}>
              {stored ? copy.archive : copy.remove}
            </Button>
          )}
          <Button type="button" onClick={() => void close()}>
            {t.common.done}
          </Button>
        </>
      }
    >
      <PrinterFields
        draft={draft}
        preset={preset}
        currency={currency}
        error={touched || !isNew ? validation : undefined}
        lifetime={!isNew && tracking}
        onChange={setDraft}
      />
      {!isNew &&
        (tracking ? (
          <PrinterMaintenance printer={printer} />
        ) : (
          <UsageTrackingInvite source="maintenance" line={t.settings.board.tracking.invite.maintenance} />
        ))}
    </DialogShell>
  )
}

function PrinterFields({
  draft,
  preset,
  currency,
  error,
  lifetime,
  onChange,
}: {
  draft: PrinterProfile
  preset?: PrinterPreset
  currency: PriceCalculatorCurrency
  error?: string
  /** Whether to show how far through its lifespan the saved printer is. */
  lifetime: boolean
  onChange: (update: (current: PrinterProfile) => PrinterProfile) => void
}) {
  const { t } = useI18n()
  const copy = t.settings.printers.dialog
  const printTypes = t.settings.printers.printTypes
  const modelName = preset && printerModelName(preset)

  const choosePreset = (next: PrinterPreset) =>
    onChange((current) => ({
      ...current,
      presetId: next.id,
      printType: next.printType,
      addOnPresetIds: next.printType === current.printType ? current.addOnPresetIds : undefined,
      slicer: next.printType === current.printType ? current.slicer : undefined,
      widthMm: next.widthMm,
      depthMm: next.depthMm,
      heightMm: next.heightMm,
    }))
  // Starts from the model it leaves so only what differs needs changing; a name that followed the model would otherwise
  // read as that model again once stored, so a custom printer starts unnamed.
  const makeCustom = () =>
    onChange((current) => {
      const previous = getPrinterPreset(current.presetId)
      if (!previous) return { ...current, presetId: undefined }
      return {
        ...current,
        presetId: undefined,
        printType: previous.printType,
        widthMm: previous.widthMm,
        depthMm: previous.depthMm,
        heightMm: previous.heightMm,
        powerWatts: printerPowerProfile(previous.id)?.watts,
      }
    })

  return (
    <>
      <section className="grid gap-2" aria-labelledby="printer-model">
        <h3 id="printer-model" className="text-sm font-medium">
          {copy.model}
        </h3>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/20 p-2.5">
          <PrinterPresetImage printer={preset ?? draft} className="size-12 rounded-md border bg-muted/40" />
          <div className="min-w-0 flex-1 basis-40">
            <p className="truncate font-medium">{modelName ?? copy.custom}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {preset ? `${printTypes[preset.printType]} · ${preset.widthMm} × ${preset.depthMm} × ${preset.heightMm} mm` : copy.customHint}
            </p>
          </div>
          <PrinterPresetPicker mode="change" current={draft.presetId} onSelect={choosePreset} onCustom={makeCustom} />
        </div>
      </section>

      <Field data-invalid={!!error || undefined}>
        <FieldLabel htmlFor="printer-name">{copy.name}</FieldLabel>
        <Input
          id="printer-name"
          value={draft.name}
          placeholder={modelName ?? copy.placeholder[draft.printType]}
          maxLength={100}
          aria-invalid={!!error || undefined}
          onChange={(event) => onChange((current) => ({ ...current, name: event.target.value }))}
        />
        {error ? <FieldError>{error}</FieldError> : <FieldDescription>{preset ? copy.nameHint : copy.customNameHint}</FieldDescription>}
      </Field>

      {!preset && <CustomPrinterSpec draft={draft} onChange={onChange} />}
      <SlicerField
        id="printer-slicer"
        printType={draft.printType}
        value={draft.slicer}
        onChange={(slicer) => onChange((current) => ({ ...current, slicer }))}
      />
      <PrinterWear draft={draft} currency={currency} lifetime={lifetime} onChange={onChange} />
      <PrinterAddOns draft={draft} onChange={onChange} />
    </>
  )
}

/** What the catalogue would otherwise supply for a printer without a model: its print type, build volume and power. */
function CustomPrinterSpec({
  draft,
  onChange,
}: {
  draft: PrinterProfile
  onChange: (update: (current: PrinterProfile) => PrinterProfile) => void
}) {
  const { t } = useI18n()
  const copy = t.settings.printers.dialog
  const printTypes = t.settings.printers.printTypes
  return (
    <>
      <Field>
        <FieldTitle aria-hidden="true">{copy.printType}</FieldTitle>
        <SegmentedControl
          legend={copy.printType}
          className="w-full sm:w-72"
          value={draft.printType}
          options={PRINT_TYPES.map((value) => ({ value, label: printTypes[value] }))}
          onChange={(printType) => onChange((current) => ({ ...current, printType, addOnPresetIds: undefined, slicer: undefined }))}
        />
      </Field>

      <section className="grid gap-2" aria-labelledby="printer-build-volume">
        <div className="grid gap-0.5">
          <h3 id="printer-build-volume" className="text-sm font-medium">
            {copy.buildVolume}
          </h3>
          <p className="text-sm text-muted-foreground">{copy.buildVolumeHint}</p>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:max-w-md">
          {DIMENSIONS.map(([key, label]) => (
            <Field key={key} className="gap-1">
              <FieldLabel htmlFor={`printer-${key}`} className="text-xs text-muted-foreground">
                {copy[label]}
              </FieldLabel>
              <Input
                id={`printer-${key}`}
                type="number"
                inputMode="decimal"
                min={1}
                className="tabular-nums"
                value={draft[key] ?? ''}
                onChange={(event) => {
                  const value = event.target.value === '' ? undefined : Number(event.target.value)
                  onChange((current) => ({ ...current, [key]: value !== undefined && value > 0 ? value : undefined }))
                }}
              />
            </Field>
          ))}
        </div>
      </section>

      <PrinterPower draft={draft} onChange={onChange} />
    </>
  )
}

/** Modules bolted onto the printer; their printing power adds to the model's in every quote. */
function PrinterAddOns({
  draft,
  onChange,
}: {
  draft: PrinterProfile
  onChange: (update: (current: PrinterProfile) => PrinterProfile) => void
}) {
  const { t, locale } = useI18n()
  const copy = t.settings.printers.dialog
  const anchor = useComboboxAnchor()
  const options = PRINTER_ADD_ON_PRESETS.filter((preset) => (preset.printType ?? 'resin') === draft.printType)
  const chosen = draft.addOnPresetIds ?? []
  const selected = options.filter((preset) => chosen.includes(preset.id))
  const power = printingPower(draft.printType, draft.presetId, chosen, draft.powerWatts)
  const watts = formatNumber(power.watts, locale)
  return (
    <Field>
      <FieldLabel htmlFor="printer-add-ons">{copy.addOns}</FieldLabel>
      <Combobox
        multiple
        items={options}
        value={selected}
        itemToStringLabel={(preset: EquipmentPreset) => equipmentPresetName(preset)}
        onValueChange={(next: EquipmentPreset[]) =>
          onChange((current) => ({ ...current, addOnPresetIds: next.length ? next.map(({ id }) => id) : undefined }))
        }
      >
        <ComboboxChips ref={anchor}>
          {selected.map((preset) => (
            <ComboboxChip key={preset.id} title={equipmentPresetName(preset)}>
              {equipmentPresetName(preset)}
            </ComboboxChip>
          ))}
          <ComboboxChipsInput id="printer-add-ons" placeholder={copy.addOnSearch} />
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>
          <ComboboxEmpty>{copy.addOnEmpty}</ComboboxEmpty>
          <ComboboxList>
            <ComboboxCollection>
              {(preset: EquipmentPreset) => (
                <ComboboxItem key={preset.id} value={preset} aria-label={equipmentPresetName(preset)}>
                  <span className="grid min-w-0 flex-1 gap-0.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                    <span className="min-w-0 whitespace-normal">{equipmentPresetName(preset)}</span>
                    <span className="min-w-0 text-xs whitespace-normal text-muted-foreground sm:text-right">
                      {copy.addOnPower(formatNumber(addOnWatts(preset), locale))}
                    </span>
                  </span>
                </ComboboxItem>
              )}
            </ComboboxCollection>
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <FieldDescription>
        {selected.length ? null : `${copy.addOnsHint} `}
        {power.typical ? copy.typicalPower(watts) : copy.printingPower(watts)}
      </FieldDescription>
    </Field>
  )
}

/** What a printer without a catalogue model draws while printing, which the catalogue would otherwise supply. */
function PrinterPower({
  draft,
  onChange,
}: {
  draft: PrinterProfile
  onChange: (update: (current: PrinterProfile) => PrinterProfile) => void
}) {
  const { t, locale } = useI18n()
  const copy = t.settings.printers.dialog
  const typical = formatNumber(DEFAULT_PRINTER_POWER_WATTS[draft.printType], locale)
  return (
    <Field className="sm:max-w-md">
      <FieldLabel htmlFor="printer-power">{copy.power}</FieldLabel>
      <OptionalNumber
        id="printer-power"
        value={draft.powerWatts}
        placeholder={typical}
        onChange={(watts) => onChange((current) => ({ ...current, powerWatts: watts > 0 ? watts : undefined }))}
      />
      <FieldDescription>{copy.powerHint(typical)}</FieldDescription>
    </Field>
  )
}

function addOnWatts(preset: EquipmentPreset) {
  return preset.powerProfiles.find(({ phase }) => phase === 'printing')?.watts ?? 0
}

/** What the printer cost, when it was bought, and how long it lasts, which quotes spread across its print hours. */
function PrinterWear({
  draft,
  currency,
  lifetime,
  onChange,
}: {
  draft: PrinterProfile
  currency: PriceCalculatorCurrency
  lifetime: boolean
  onChange: (update: (current: PrinterProfile) => PrinterProfile) => void
}) {
  const { t, locale } = useI18n()
  const copy = t.settings.printers.dialog
  const wear = printerWear(draft)
  const set = (key: 'purchasePrice' | 'lifespanHours') => (value: number) =>
    onChange((current) => ({ ...current, [key]: value > 0 ? value : undefined }))
  return (
    <section className="grid gap-2" aria-labelledby="printer-wear">
      <div className="grid gap-0.5">
        <h3 id="printer-wear" className="text-sm font-medium">
          {copy.wear}
        </h3>
        <p className="text-sm text-muted-foreground">
          {(wear.typical ? copy.wearTypical : copy.wearPerHour)(formatRate(wear.perHour, currency, locale))}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:max-w-md">
        <Field className="gap-1">
          <FieldLabel htmlFor="printer-purchase-price" className="text-xs text-muted-foreground">
            {copy.purchasePrice(currencySymbol(currency, locale))}
          </FieldLabel>
          <OptionalNumber id="printer-purchase-price" value={draft.purchasePrice} onChange={set('purchasePrice')} />
        </Field>
        <Field className="gap-1">
          <FieldLabel htmlFor="printer-lifespan" className="text-xs text-muted-foreground">
            {copy.lifespanHours}
          </FieldLabel>
          <OptionalNumber id="printer-lifespan" value={draft.lifespanHours} onChange={set('lifespanHours')} />
        </Field>
      </div>
      {lifetime && <PrinterLifetimeLine printerId={draft.id} lifespanHours={draft.lifespanHours} />}
      <div className="sm:max-w-md">
        <PurchaseDateField
          id="printer-purchased-on"
          value={draft.purchasedOn}
          onChange={(purchasedOn) => onChange((current) => ({ ...current, purchasedOn }))}
        />
      </div>
      <p className="text-xs text-muted-foreground">{copy.wearHint}</p>
    </section>
  )
}

function OptionalNumber({
  id,
  value,
  placeholder,
  onChange,
}: {
  id: string
  value?: number
  placeholder?: string
  onChange: (value: number) => void
}) {
  return (
    <Input
      id={id}
      placeholder={placeholder}
      type="number"
      inputMode="decimal"
      min={0}
      step="any"
      className="tabular-nums"
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value === '' ? 0 : event.target.valueAsNumber)}
    />
  )
}

/** Empties a catalogue printer's name while it is the model's own, so the field shows it as the default it is. */
function withFollowedName(printer: PrinterProfile): PrinterProfile {
  const preset = getPrinterPreset(printer.presetId)
  const follows = preset && printer.name.trim().toLocaleLowerCase() === printerModelName(preset).toLocaleLowerCase()
  return follows ? { ...printer, name: '' } : printer
}
