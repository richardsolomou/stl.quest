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
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { EQUIPMENT_PRESETS, getEquipmentPreset, printerPowerProfile, type EquipmentPreset } from '../../../core/equipmentPresets'
import {
  applyEquipmentPresets,
  equipmentSettingsFor,
  selectEquipmentMode,
  updateEquipmentSettings,
  type PriceCalculatorEquipmentSettings,
  type PriceCalculatorSettings,
} from '../../../core/priceCalculator'
import { getPrinterPreset, PRINTER_PRESETS, type PrinterPreset } from '../../../core/printerPresets'
import { useI18n } from '../../i18n'
import { FilterCombobox } from '../FilterCombobox'
import { ModeSelector, NumberSetting, SetupGroup } from './fields'
import { formatNumber, formatPowerProfiles, formatPrinterPower } from './format'

type EquipmentOption = { value: string; label: string; preset: EquipmentPreset }
type PrinterOption = { value: string; label: string; preset: PrinterPreset }

export function EquipmentSetup({
  settings,
  onSettingsChange,
}: {
  settings: PriceCalculatorSettings
  onSettingsChange: (settings: PriceCalculatorSettings) => void
}) {
  const copy = useI18n().t.calculator.equipment
  const equipment = equipmentSettingsFor(settings)
  const activePresetIds = equipment.presetIds
  const printerPresetId = activePresetIds.find((id) => getPrinterPreset(id))
  const accessoryPresetIds = activePresetIds.filter((id) => {
    const preset = getEquipmentPreset(id)
    return preset && !preset.id.startsWith('printer-')
  })
  const applyPresets = (presetIds: string[]) => onSettingsChange(applyEquipmentPresets(settings, presetIds))
  const updateEquipment = (next: PriceCalculatorEquipmentSettings) => onSettingsChange(updateEquipmentSettings(settings, next))
  return (
    <SetupGroup
      title={copy.title}
      description={copy.description}
      action={
        <ModeSelector
          legend={copy.modeLegend}
          value={equipment.mode}
          onChange={(next) => onSettingsChange(selectEquipmentMode(settings, next))}
        />
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {equipment.mode === 'preset' ? (
          <>
            <PrinterPresetPicker
              printType={settings.printType}
              value={printerPresetId}
              onChange={(id) => applyPresets([...(id ? [id] : []), ...accessoryPresetIds])}
            />
            <AccessoryPresetPicker
              printType={settings.printType}
              value={accessoryPresetIds}
              onChange={(ids) => applyPresets([...(printerPresetId ? [printerPresetId] : []), ...ids])}
            />
            <PowerSummary printType={settings.printType} equipment={equipment} />
          </>
        ) : (
          <>
            <NumberSetting
              label={copy.printPower}
              value={equipment.printPowerWatts}
              min={0}
              onChange={(printPowerWatts) => updateEquipment({ ...equipment, printPowerWatts })}
            />
            <NumberSetting
              label={copy.dryPower}
              value={equipment.dryPowerWatts}
              min={0}
              onChange={(dryPowerWatts) => updateEquipment({ ...equipment, dryPowerWatts })}
            />
            {settings.printType === 'resin' && (
              <>
                <NumberSetting
                  label={copy.washPower}
                  value={equipment.washPowerWatts}
                  min={0}
                  onChange={(washPowerWatts) => updateEquipment({ ...equipment, washPowerWatts })}
                />
                <NumberSetting
                  label={copy.curePower}
                  value={equipment.curePowerWatts}
                  min={0}
                  onChange={(curePowerWatts) => updateEquipment({ ...equipment, curePowerWatts })}
                />
              </>
            )}
          </>
        )}
        {settings.printType === 'resin' && (
          <NumberSetting
            label={copy.washTime}
            value={equipment.washMinutesPerPlate}
            min={0}
            onChange={(washMinutesPerPlate) => updateEquipment({ ...equipment, washMinutesPerPlate })}
          />
        )}
        <NumberSetting
          label={settings.printType === 'resin' ? copy.dryTime : copy.filamentDryTime}
          value={equipment.dryMinutesPerPlate}
          min={0}
          onChange={(dryMinutesPerPlate) => updateEquipment({ ...equipment, dryMinutesPerPlate })}
        />
        {settings.printType === 'resin' && (
          <NumberSetting
            label={copy.cureTime}
            value={equipment.cureMinutesPerPlate}
            min={0}
            onChange={(cureMinutesPerPlate) => updateEquipment({ ...equipment, cureMinutesPerPlate })}
          />
        )}
      </div>
    </SetupGroup>
  )
}

function PowerSummary({
  printType,
  equipment,
}: {
  printType: PriceCalculatorSettings['printType']
  equipment: PriceCalculatorEquipmentSettings
}) {
  const { t, locale } = useI18n()
  const copy = t.calculator.equipment
  const totals = [
    ['printing', equipment.printPowerWatts],
    ...(printType === 'resin' ? ([['washing', equipment.washPowerWatts]] as const) : []),
    ['drying', equipment.dryPowerWatts],
    ...(printType === 'resin' ? ([['curing', equipment.curePowerWatts]] as const) : []),
  ] as const
  return (
    <div className="grid grid-cols-2 gap-2 sm:col-span-2 sm:grid-cols-4" aria-label={copy.powerTotals}>
      {totals.map(([phase, watts]) => (
        <div key={phase} className="rounded-md border border-border/60 bg-background/70 px-3 py-2">
          <div className="text-[0.68rem] font-medium tracking-wide text-muted-foreground uppercase">{copy.phases[phase]}</div>
          <div className="mt-0.5 font-mono text-sm font-medium tabular-nums">{formatNumber(watts, locale)} W</div>
        </div>
      ))}
    </div>
  )
}

function PrinterPresetPicker({
  printType,
  value,
  onChange,
}: {
  printType: PriceCalculatorSettings['printType']
  value?: string
  onChange: (value?: string) => void
}) {
  const { t, locale } = useI18n()
  const copy = t.calculator.equipment
  const options: PrinterOption[] = PRINTER_PRESETS.filter((preset) => preset.printType === printType).map((preset) => ({
    value: preset.id,
    label: `${preset.brand} ${preset.model}`,
    preset,
  }))
  const selectedPower = value ? printerPowerProfile(value) : undefined
  return (
    <Field className="sm:col-span-2">
      <FieldLabel htmlFor="calculator-printer-preset">{copy.printer}</FieldLabel>
      <FilterCombobox
        id="calculator-printer-preset"
        value={value}
        onChange={onChange}
        options={options}
        placeholder={printType === 'resin' ? copy.resinPrinterSearch : copy.filamentPrinterSearch}
        emptyLabel={copy.printerEmpty}
        renderOption={(option) => <PresetOption label={option.label} detail={formatPrinterPower(option.value, locale)} />}
      />
      <FieldDescription>
        {selectedPower
          ? `${formatNumber(selectedPower.watts, locale)} W · ${selectedPower.basis ?? t.calculator.defaultPowerBasis}`
          : copy.printerCount(options.length)}
      </FieldDescription>
    </Field>
  )
}

function AccessoryPresetPicker({
  printType,
  value,
  onChange,
}: {
  printType: PriceCalculatorSettings['printType']
  value: string[]
  onChange: (value: string[]) => void
}) {
  const copy = useI18n().t.calculator
  const anchor = useComboboxAnchor()
  const options: EquipmentOption[] = EQUIPMENT_PRESETS.filter(
    (preset) => !preset.id.startsWith('printer-') && (preset.printType ?? 'resin') === printType,
  ).map((preset) => ({ value: preset.id, label: `${preset.brand} ${preset.model}`, preset }))
  const selected = options.filter((option) => value.includes(option.value))
  return (
    <Field className="sm:col-span-2">
      <FieldLabel htmlFor="calculator-accessory-presets">{copy.equipment.accessories}</FieldLabel>
      <Combobox
        multiple
        items={options}
        value={selected}
        itemToStringLabel={(option: EquipmentOption) => option.label}
        onValueChange={(next: EquipmentOption[]) => onChange(next.map((option) => option.value))}
      >
        <ComboboxChips ref={anchor}>
          {selected.map((option) => (
            <ComboboxChip key={option.value} title={option.label}>
              {option.label}
            </ComboboxChip>
          ))}
          <ComboboxChipsInput id="calculator-accessory-presets" placeholder={copy.equipment.accessorySearch} />
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>
          <ComboboxEmpty>{copy.equipment.accessoryEmpty}</ComboboxEmpty>
          <ComboboxList>
            <ComboboxCollection>
              {(option: EquipmentOption) => (
                <ComboboxItem key={option.value} value={option} aria-label={option.label}>
                  <PresetOption label={option.label} detail={formatPowerProfiles(option.preset, copy)} />
                </ComboboxItem>
              )}
            </ComboboxCollection>
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      {!selected.length && <FieldDescription>{copy.equipment.accessoriesHint}</FieldDescription>}
    </Field>
  )
}

function PresetOption({ label, detail }: { label: string; detail: string }) {
  return (
    <span className="grid min-w-0 flex-1 gap-0.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
      <span className="min-w-0 whitespace-normal">{label}</span>
      <span className="min-w-0 whitespace-normal text-xs text-muted-foreground sm:text-right">{detail}</span>
    </span>
  )
}
