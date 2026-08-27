import type { FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { ELECTRICITY_PRICE_PRESETS, getElectricityPricePreset } from '../../../core/electricityPresets'
import { DEFAULT_PRICE_CALCULATOR_SETTINGS, type PriceCalculatorSettings } from '../../../core/priceCalculator'
import { getResinPreset, RESIN_PRESETS } from '../../../core/resinPresets'
import { FilterCombobox } from '../FilterCombobox'
import { SettingsActions, SettingsSection } from '../settings/SettingsLayout'
import { EquipmentSetup } from './EquipmentSetup'
import { ModeSelector, NumberSetting, SetupGroup, type SetupMode } from './fields'
import { countryFlag, electricitySourceLabel, formatEurosPerKwh, formatNumber } from './format'

const resinOptions = RESIN_PRESETS.map((preset) => ({
  value: preset.id,
  label: `${preset.brand} ${preset.name}`,
  type: preset.type,
}))

const electricityOptions = ELECTRICITY_PRICE_PRESETS.map((preset) => ({
  value: preset.countryCode,
  label: `${countryFlag(preset.countryCode)} ${preset.countryName} · ${formatEurosPerKwh(preset.eurPerKwh)}`,
  countryName: preset.countryName,
}))

export function SetupForm({
  settings,
  resinMode,
  electricityMode,
  dirty,
  saving,
  error,
  onSettingsChange,
  onResinModeChange,
  onElectricityModeChange,
  onSave,
}: {
  settings: PriceCalculatorSettings
  resinMode: SetupMode
  electricityMode: SetupMode
  dirty: boolean
  saving: boolean
  error: unknown
  onSettingsChange: (settings: PriceCalculatorSettings) => void
  onResinModeChange: (mode: SetupMode) => void
  onElectricityModeChange: (mode: SetupMode) => void
  onSave: () => void
}) {
  const save = (event: FormEvent) => {
    event.preventDefault()
    onSave()
  }
  return (
    <form className="lg:col-start-1 lg:row-start-2" onSubmit={save}>
      <SettingsSection
        title="Saved setup"
        description="These defaults belong to this workspace and will be here next time. Job values above remain a disposable scratchpad."
        disabled={saving}
      >
        <div className="grid gap-4">
          <EquipmentSetup settings={settings} onSettingsChange={onSettingsChange} />
          <MaterialSetup settings={settings} mode={resinMode} onModeChange={onResinModeChange} onSettingsChange={onSettingsChange} />
          <ElectricitySetup
            settings={settings}
            mode={electricityMode}
            onModeChange={onElectricityModeChange}
            onSettingsChange={onSettingsChange}
          />
          <PricingSetup settings={settings} onSettingsChange={onSettingsChange} />
        </div>
        <SettingsActions>
          <Button type="submit" disabled={saving || !dirty}>
            {saving && <Spinner />} Save setup
          </Button>
          {error != null && <FieldError>{error instanceof Error ? error.message : 'The setup could not be saved.'}</FieldError>}
        </SettingsActions>
      </SettingsSection>
    </form>
  )
}

function MaterialSetup({
  settings,
  mode,
  onModeChange,
  onSettingsChange,
}: {
  settings: PriceCalculatorSettings
  mode: SetupMode
  onModeChange: (mode: SetupMode) => void
  onSettingsChange: (settings: PriceCalculatorSettings) => void
}) {
  const selectedResin = getResinPreset(settings.resinPresetId)
  return (
    <SetupGroup
      title="Material"
      description={
        settings.printType === 'resin' ? 'Choose a sourced resin or enter its properties.' : 'Use the price of the filament spool.'
      }
      action={
        settings.printType === 'resin' ? (
          <ModeSelector
            label="Resin"
            value={mode}
            onChange={(next) => {
              onModeChange(next)
              if (next === 'custom') onSettingsChange({ ...settings, resinPresetId: undefined })
            }}
          />
        ) : undefined
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {settings.printType === 'filament' ? (
          <NumberSetting
            label="Filament price (€/kg)"
            value={settings.filamentPricePerKg}
            min={0.01}
            onChange={(filamentPricePerKg) => onSettingsChange({ ...settings, filamentPricePerKg })}
          />
        ) : mode === 'preset' ? (
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="calculator-resin-preset">Resin preset</FieldLabel>
            <FilterCombobox
              id="calculator-resin-preset"
              value={settings.resinPresetId}
              options={resinOptions}
              placeholder="Search resin presets…"
              emptyLabel="No matching resin presets."
              onChange={(resinPresetId) => {
                const preset = getResinPreset(resinPresetId)
                if (!preset) {
                  onModeChange('custom')
                  onSettingsChange({ ...settings, resinPresetId: undefined })
                  return
                }
                onSettingsChange({
                  ...settings,
                  resinPresetId: preset.id,
                  resinDensityGramsPerMl: preset.densityGramsPerMl ?? DEFAULT_PRICE_CALCULATOR_SETTINGS.resinDensityGramsPerMl,
                })
              }}
              renderOption={(option) => (
                <span className="grid min-w-0 flex-1 gap-0.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                  <span className="min-w-0 whitespace-normal">{option.label}</span>
                  {option.type && (
                    <span className="min-w-0 whitespace-normal text-xs text-muted-foreground sm:text-right">{option.type}</span>
                  )}
                </span>
              )}
            />
            <FieldDescription>
              {selectedResin ? (
                <>
                  {selectedResin.densityGramsPerMl && `${formatNumber(selectedResin.densityGramsPerMl)} g/mL · `}
                  Sourced from{' '}
                  <a className="underline underline-offset-2" href={selectedResin.source.url} target="_blank" rel="noreferrer">
                    {selectedResin.source.id === 'prusaslicer' ? 'PrusaSlicer' : selectedResin.brand}
                  </a>
                  {selectedResin.densitySource && (
                    <>
                      {' · '}
                      <a className="underline underline-offset-2" href={selectedResin.densitySource.url} target="_blank" rel="noreferrer">
                        View density source
                      </a>
                    </>
                  )}
                </>
              ) : (
                `${RESIN_PRESETS.length} sourced presets available.`
              )}
            </FieldDescription>
          </Field>
        ) : (
          <NumberSetting
            label="Resin density (g/mL)"
            value={settings.resinDensityGramsPerMl}
            min={0.01}
            onChange={(resinDensityGramsPerMl) => onSettingsChange({ ...settings, resinDensityGramsPerMl })}
          />
        )}
        {settings.printType === 'resin' && (
          <NumberSetting
            label="Resin price (€/L)"
            value={settings.resinPricePerLitre}
            min={0.01}
            onChange={(resinPricePerLitre) => onSettingsChange({ ...settings, resinPricePerLitre })}
          />
        )}
      </div>
    </SetupGroup>
  )
}

function ElectricitySetup({
  settings,
  mode,
  onModeChange,
  onSettingsChange,
}: {
  settings: PriceCalculatorSettings
  mode: SetupMode
  onModeChange: (mode: SetupMode) => void
  onSettingsChange: (settings: PriceCalculatorSettings) => void
}) {
  const selected = getElectricityPricePreset(settings.electricityCountryCode)
  return (
    <SetupGroup
      title="Electricity"
      description="Use a country average or your own all-in tariff."
      action={
        <ModeSelector
          label="Electricity"
          value={mode}
          onChange={(next) => {
            onModeChange(next)
            if (next === 'custom') onSettingsChange({ ...settings, electricityCountryCode: undefined })
          }}
        />
      }
    >
      {mode === 'preset' ? (
        <Field>
          <FieldLabel htmlFor="calculator-electricity-country">Country electricity preset</FieldLabel>
          <FilterCombobox
            id="calculator-electricity-country"
            value={settings.electricityCountryCode}
            options={electricityOptions}
            placeholder="Search countries…"
            emptyLabel="No matching country. Choose Custom to enter your tariff."
            optionAriaLabel={(option) => option.countryName}
            onChange={(electricityCountryCode) => {
              const preset = getElectricityPricePreset(electricityCountryCode)
              if (!preset) {
                onModeChange('custom')
                onSettingsChange({ ...settings, electricityCountryCode: undefined })
                return
              }
              onSettingsChange({ ...settings, electricityCountryCode, electricityPricePerKwh: preset.eurPerKwh })
            }}
          />
          <FieldDescription>
            {selected ? (
              <>
                {formatEurosPerKwh(selected.eurPerKwh)} · {electricitySourceLabel(selected)} ·{' '}
                <a className="underline underline-offset-2" href={selected.source.url} target="_blank" rel="noreferrer">
                  View source
                </a>
              </>
            ) : (
              `${ELECTRICITY_PRICE_PRESETS.length} sourced country averages available.`
            )}
          </FieldDescription>
        </Field>
      ) : (
        <NumberSetting
          label="Electricity (€/kWh)"
          value={settings.electricityPricePerKwh}
          min={0}
          onChange={(electricityPricePerKwh) => onSettingsChange({ ...settings, electricityPricePerKwh })}
          description="Use the all-in rate from your bill when possible."
        />
      )}
    </SetupGroup>
  )
}

function PricingSetup({
  settings,
  onSettingsChange,
}: {
  settings: PriceCalculatorSettings
  onSettingsChange: (settings: PriceCalculatorSettings) => void
}) {
  return (
    <SetupGroup title="Pricing" description="Set wear, consumables, labour, allowances, and margin for every quote.">
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberSetting
          label="Equipment wear (€/h)"
          value={settings.equipmentCostPerHour}
          min={0}
          onChange={(equipmentCostPerHour) => onSettingsChange({ ...settings, equipmentCostPerHour })}
        />
        <NumberSetting
          label="Consumables (€/plate)"
          value={settings.consumablesCostPerPlate}
          min={0}
          onChange={(consumablesCostPerPlate) => onSettingsChange({ ...settings, consumablesCostPerPlate })}
        />
        <NumberSetting
          label="Labour (€/h)"
          value={settings.labourCostPerHour}
          min={0}
          onChange={(labourCostPerHour) => onSettingsChange({ ...settings, labourCostPerHour })}
        />
        <NumberSetting
          label="Failure allowance (%)"
          value={settings.failureAllowancePercent}
          min={0}
          max={100}
          onChange={(failureAllowancePercent) => onSettingsChange({ ...settings, failureAllowancePercent })}
        />
        <NumberSetting
          label="Standard margin (%)"
          value={settings.standardMarginPercent}
          min={0}
          max={95}
          onChange={(standardMarginPercent) => onSettingsChange({ ...settings, standardMarginPercent })}
        />
      </div>
    </SetupGroup>
  )
}
