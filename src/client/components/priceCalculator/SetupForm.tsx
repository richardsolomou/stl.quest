import { useMemo, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { ELECTRICITY_PRICE_PRESETS, getElectricityPricePreset } from '../../../core/electricityPresets'
import {
  DEFAULT_PRICE_CALCULATOR_SETTINGS,
  electricityPresetsAvailable,
  PRICE_CALCULATOR_CURRENCIES,
  selectPriceCalculatorCurrency,
  type PriceCalculatorCurrency,
  type PriceCalculatorSettings,
} from '../../../core/priceCalculator'
import { getResinPreset, RESIN_PRESETS } from '../../../core/resinPresets'
import { useI18n } from '../../i18n'
import { FilterCombobox } from '../FilterCombobox'
import { SettingsActions, SettingsSection } from '../settings/SettingsLayout'
import { EquipmentSetup } from './EquipmentSetup'
import { ModeSelector, NumberSetting, SetupGroup, type SetupMode } from './fields'
import { countryFlag, countryName, currencyLabel, currencySymbol, electricitySourceLabel, formatEurosPerKwh, formatNumber } from './format'

const resinOptions = RESIN_PRESETS.map((preset) => ({
  value: preset.id,
  label: `${preset.brand} ${preset.name}`,
  type: preset.type,
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
  const copy = useI18n().t.calculator.setup
  const save = (event: FormEvent) => {
    event.preventDefault()
    onSave()
  }
  return (
    <form className="lg:col-start-1 lg:row-start-2" onSubmit={save}>
      <SettingsSection title={copy.title} description={copy.description} disabled={saving}>
        <div className="grid gap-4">
          <CurrencySetup
            settings={settings}
            onCurrencyChange={(currency) => {
              onSettingsChange(selectPriceCalculatorCurrency(settings, currency))
              if (!electricityPresetsAvailable(currency)) onElectricityModeChange('custom')
            }}
          />
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
            {saving && <Spinner />} {copy.save}
          </Button>
          {error != null && <FieldError>{error instanceof Error ? error.message : copy.saveError}</FieldError>}
        </SettingsActions>
      </SettingsSection>
    </form>
  )
}

function CurrencySetup({
  settings,
  onCurrencyChange,
}: {
  settings: PriceCalculatorSettings
  onCurrencyChange: (currency: PriceCalculatorCurrency) => void
}) {
  const { t, locale } = useI18n()
  const copy = t.calculator.currency
  const currencyOptions = useMemo(
    () => PRICE_CALCULATOR_CURRENCIES.map((currency) => ({ value: currency, label: currencyLabel(currency, locale) })),
    [locale],
  )
  return (
    <SetupGroup title={copy.title} description={copy.description}>
      <Field>
        <FieldLabel htmlFor="calculator-currency">{copy.label}</FieldLabel>
        <Select items={currencyOptions} value={settings.currency} onValueChange={(currency) => currency && onCurrencyChange(currency)}>
          <SelectTrigger className="w-full" id="calculator-currency">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {currencyOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </SetupGroup>
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
  const { t, locale } = useI18n()
  const copy = t.calculator.material
  const selectedResin = getResinPreset(settings.resinPresetId)
  const symbol = currencySymbol(settings.currency, locale)
  return (
    <SetupGroup
      title={copy.title}
      description={settings.printType === 'resin' ? copy.resinDescription : copy.filamentDescription}
      action={
        settings.printType === 'resin' ? (
          <ModeSelector
            legend={copy.modeLegend}
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
            label={copy.filamentPrice(symbol)}
            value={settings.filamentPricePerKg}
            min={0.01}
            onChange={(filamentPricePerKg) => onSettingsChange({ ...settings, filamentPricePerKg })}
          />
        ) : mode === 'preset' ? (
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="calculator-resin-preset">{copy.resinPreset}</FieldLabel>
            <FilterCombobox
              id="calculator-resin-preset"
              value={settings.resinPresetId}
              options={resinOptions}
              placeholder={copy.resinSearch}
              emptyLabel={copy.resinEmpty}
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
                  {selectedResin.densityGramsPerMl && `${formatNumber(selectedResin.densityGramsPerMl, locale)} g/mL · `}
                  {copy.sourcedFrom}{' '}
                  <a className="underline underline-offset-2" href={selectedResin.source.url} target="_blank" rel="noreferrer">
                    {selectedResin.source.id === 'prusaslicer' ? 'PrusaSlicer' : selectedResin.brand}
                  </a>
                  {selectedResin.densitySource && (
                    <>
                      {' · '}
                      <a className="underline underline-offset-2" href={selectedResin.densitySource.url} target="_blank" rel="noreferrer">
                        {copy.densitySource}
                      </a>
                    </>
                  )}
                </>
              ) : (
                copy.presetCount(RESIN_PRESETS.length)
              )}
            </FieldDescription>
          </Field>
        ) : (
          <NumberSetting
            label={copy.resinDensity}
            value={settings.resinDensityGramsPerMl}
            min={0.01}
            onChange={(resinDensityGramsPerMl) => onSettingsChange({ ...settings, resinDensityGramsPerMl })}
          />
        )}
        {settings.printType === 'resin' && (
          <NumberSetting
            label={copy.resinPrice(symbol)}
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
  const { t, locale } = useI18n()
  const copy = t.calculator.electricity
  const electricityOptions = useMemo(
    () =>
      ELECTRICITY_PRICE_PRESETS.map((preset) => {
        const name = countryName(preset, locale)
        return {
          value: preset.countryCode,
          label: `${countryFlag(preset.countryCode)} ${name} · ${formatEurosPerKwh(preset.eurPerKwh, locale)}`,
          countryName: name,
        }
      }),
    [locale],
  )
  const selected = getElectricityPricePreset(settings.electricityCountryCode)
  const presetsAvailable = electricityPresetsAvailable(settings.currency)
  return (
    <SetupGroup
      title={copy.title}
      description={presetsAvailable ? copy.presetsDescription : copy.customDescription}
      action={
        presetsAvailable && (
          <ModeSelector
            legend={copy.modeLegend}
            value={mode}
            onChange={(next) => {
              onModeChange(next)
              if (next === 'custom') onSettingsChange({ ...settings, electricityCountryCode: undefined })
            }}
          />
        )
      }
    >
      {presetsAvailable && mode === 'preset' ? (
        <Field>
          <FieldLabel htmlFor="calculator-electricity-country">{copy.countryPreset}</FieldLabel>
          <FilterCombobox
            id="calculator-electricity-country"
            value={settings.electricityCountryCode}
            options={electricityOptions}
            placeholder={copy.countrySearch}
            emptyLabel={copy.countryEmpty}
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
                {formatEurosPerKwh(selected.eurPerKwh, locale)} · {electricitySourceLabel(selected, t.calculator)} ·{' '}
                <a className="underline underline-offset-2" href={selected.source.url} target="_blank" rel="noreferrer">
                  {copy.viewSource}
                </a>
              </>
            ) : (
              copy.presetCount(ELECTRICITY_PRICE_PRESETS.length)
            )}
          </FieldDescription>
        </Field>
      ) : (
        <NumberSetting
          label={copy.price(currencySymbol(settings.currency, locale))}
          value={settings.electricityPricePerKwh}
          min={0}
          onChange={(electricityPricePerKwh) => onSettingsChange({ ...settings, electricityPricePerKwh })}
          description={copy.priceHint}
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
  const { t, locale } = useI18n()
  const copy = t.calculator.pricing
  const symbol = currencySymbol(settings.currency, locale)
  return (
    <SetupGroup title={copy.title} description={copy.description}>
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberSetting
          label={copy.equipmentWear(symbol)}
          value={settings.equipmentCostPerHour}
          min={0}
          onChange={(equipmentCostPerHour) => onSettingsChange({ ...settings, equipmentCostPerHour })}
        />
        <NumberSetting
          label={copy.consumables(symbol)}
          value={settings.consumablesCostPerPlate}
          min={0}
          onChange={(consumablesCostPerPlate) => onSettingsChange({ ...settings, consumablesCostPerPlate })}
        />
        <NumberSetting
          label={copy.labour(symbol)}
          value={settings.labourCostPerHour}
          min={0}
          onChange={(labourCostPerHour) => onSettingsChange({ ...settings, labourCostPerHour })}
        />
        <NumberSetting
          label={copy.failureAllowance}
          value={settings.failureAllowancePercent}
          min={0}
          max={100}
          onChange={(failureAllowancePercent) => onSettingsChange({ ...settings, failureAllowancePercent })}
        />
        <NumberSetting
          label={copy.standardMargin}
          value={settings.standardMarginPercent}
          min={0}
          max={95}
          onChange={(standardMarginPercent) => onSettingsChange({ ...settings, standardMarginPercent })}
        />
      </div>
    </SetupGroup>
  )
}
