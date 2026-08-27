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
      title="Equipment"
      description="Choose your printer and accessories, or enter their power draw."
      action={
        <ModeSelector label="Equipment" value={equipment.mode} onChange={(next) => onSettingsChange(selectEquipmentMode(settings, next))} />
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
              label="Printing power incl. accessories (W)"
              value={equipment.printPowerWatts}
              min={0}
              onChange={(printPowerWatts) => updateEquipment({ ...equipment, printPowerWatts })}
            />
            <NumberSetting
              label="Dry power (W)"
              value={equipment.dryPowerWatts}
              min={0}
              onChange={(dryPowerWatts) => updateEquipment({ ...equipment, dryPowerWatts })}
            />
            {settings.printType === 'resin' && (
              <>
                <NumberSetting
                  label="Wash power (W)"
                  value={equipment.washPowerWatts}
                  min={0}
                  onChange={(washPowerWatts) => updateEquipment({ ...equipment, washPowerWatts })}
                />
                <NumberSetting
                  label="Cure power (W)"
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
            label="Wash time per plate (min)"
            value={equipment.washMinutesPerPlate}
            min={0}
            onChange={(washMinutesPerPlate) => updateEquipment({ ...equipment, washMinutesPerPlate })}
          />
        )}
        <NumberSetting
          label={settings.printType === 'resin' ? 'Dry time per plate (min)' : 'Filament drying time (min)'}
          value={equipment.dryMinutesPerPlate}
          min={0}
          onChange={(dryMinutesPerPlate) => updateEquipment({ ...equipment, dryMinutesPerPlate })}
        />
        {settings.printType === 'resin' && (
          <NumberSetting
            label="Cure time per plate (min)"
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
  const totals = [
    ['Printing', equipment.printPowerWatts],
    ...(printType === 'resin' ? ([['Washing', equipment.washPowerWatts]] as const) : []),
    ['Drying', equipment.dryPowerWatts],
    ...(printType === 'resin' ? ([['Curing', equipment.curePowerWatts]] as const) : []),
  ] as const
  return (
    <div className="grid grid-cols-2 gap-2 sm:col-span-2 sm:grid-cols-4" aria-label="Equipment power totals">
      {totals.map(([label, watts]) => (
        <div key={label} className="rounded-md border border-border/60 bg-background/70 px-3 py-2">
          <div className="text-[0.68rem] font-medium tracking-wide text-muted-foreground uppercase">{label}</div>
          <div className="mt-0.5 font-mono text-sm font-medium tabular-nums">{formatNumber(watts)} W</div>
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
  const options: PrinterOption[] = PRINTER_PRESETS.filter((preset) => preset.printType === printType).map((preset) => ({
    value: preset.id,
    label: `${preset.brand} ${preset.model}`,
    preset,
  }))
  const selectedPower = value ? printerPowerProfile(value) : undefined
  return (
    <Field className="sm:col-span-2">
      <FieldLabel htmlFor="calculator-printer-preset">Printer</FieldLabel>
      <FilterCombobox
        id="calculator-printer-preset"
        value={value}
        onChange={onChange}
        options={options}
        placeholder={`Search ${printType === 'resin' ? 'resin' : 'FDM'} printers…`}
        emptyLabel="No matching printer preset."
        renderOption={(option) => <PresetOption label={option.label} detail={formatPrinterPower(option.value)} />}
      />
      <FieldDescription>
        {selectedPower
          ? `${formatNumber(selectedPower.watts)} W · ${selectedPower.basis}`
          : `${options.length} printers available from the main printer catalogue.`}
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
  const anchor = useComboboxAnchor()
  const options: EquipmentOption[] = EQUIPMENT_PRESETS.filter(
    (preset) => !preset.id.startsWith('printer-') && (preset.printType ?? 'resin') === printType,
  ).map((preset) => ({ value: preset.id, label: `${preset.brand} ${preset.model}`, preset }))
  const selected = options.filter((option) => value.includes(option.value))
  return (
    <Field className="sm:col-span-2">
      <FieldLabel htmlFor="calculator-accessory-presets">Accessories</FieldLabel>
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
          <ComboboxChipsInput id="calculator-accessory-presets" placeholder="Add accessories…" />
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>
          <ComboboxEmpty>No matching accessory preset.</ComboboxEmpty>
          <ComboboxList>
            <ComboboxCollection>
              {(option: EquipmentOption) => (
                <ComboboxItem key={option.value} value={option} aria-label={option.label}>
                  <PresetOption label={option.label} detail={formatPowerProfiles(option.preset)} />
                </ComboboxItem>
              )}
            </ComboboxCollection>
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      {!selected.length && (
        <FieldDescription>Optional powered accessories and post-processing equipment for this print type.</FieldDescription>
      )}
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
