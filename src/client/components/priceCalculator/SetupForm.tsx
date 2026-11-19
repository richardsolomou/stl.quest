import { useMemo, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { consumablesOfKind, partCostPerHour, partCostPerPlate, wearPartsFor, type Consumable } from '../../../core/consumables'
import { ELECTRICITY_PRICE_PRESETS, getElectricityPricePreset } from '../../../core/electricityPresets'
import {
  DEFAULT_PRICE_CALCULATOR_SETTINGS,
  electricityPresetsAvailable,
  PRICE_CALCULATOR_CURRENCIES,
  equipmentSettingsFor,
  selectPriceCalculatorCurrency,
  updateEquipmentSettings,
  type PriceCalculatorCurrency,
  type PriceCalculatorSettings,
} from '../../../core/priceCalculator'
import { getPrinterPreset } from '../../../core/printerPresets'
import { getResinPreset, RESIN_PRESETS } from '../../../core/resinPresets'
import { useI18n } from '../../i18n'
import { FilterCombobox } from '../FilterCombobox'
import { SettingsActions, SettingsSection } from '../settings/SettingsLayout'
import { EquipmentSetup } from './EquipmentSetup'
import { ModeSelector, NumberSetting, SetupGroup, type SetupMode } from './fields'
import {
  countryFlag,
  countryName,
  currencyLabel,
  currencySymbol,
  electricitySourceLabel,
  formatEurosPerKwh,
  formatMoney,
  formatNumber,
} from './format'

const resinOptions = RESIN_PRESETS.map((preset) => ({
  value: preset.id,
  label: `${preset.brand} ${preset.name}`,
  type: preset.type,
}))

export type SetupScope = { printerName: string; printerFixed: boolean; ownCosts: boolean; onUseWorkspaceSetup: () => void }

export function SetupForm({
  settings,
  consumables,
  scope,
  resinMode,
  electricityMode,
  dirty,
  saving,
  error,
  open,
  onOpenChange,
  onSettingsChange,
  onResinModeChange,
  onElectricityModeChange,
  onSave,
  onDiscard,
}: {
  settings: PriceCalculatorSettings
  consumables: Consumable[]
  scope?: SetupScope
  resinMode: SetupMode
  electricityMode: SetupMode
  dirty: boolean
  saving: boolean
  error: unknown
  open: boolean
  onOpenChange: (open: boolean) => void
  onSettingsChange: (settings: PriceCalculatorSettings) => void
  onResinModeChange: (mode: SetupMode) => void
  onElectricityModeChange: (mode: SetupMode) => void
  onSave: () => void
  onDiscard: () => void
}) {
  const copy = useI18n().t.calculator.setup
  const save = (event: FormEvent) => {
    event.preventDefault()
    onSave()
  }
  // The setup is set once and then mostly read, so it folds to a summary until someone needs to change it.
  const expanded = open || dirty
  return (
    <form className="lg:col-start-1 lg:row-start-2" onSubmit={save}>
      <SettingsSection title={copy.title} description={copy.description} disabled={saving}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SetupSummary settings={settings} consumables={consumables} />
          {!expanded && (
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(true)}>
              <Pencil />
              {copy.edit}
            </Button>
          )}
        </div>
        {scope && <ScopeNotice scope={scope} />}
        {expanded && (
          <>
            <div className="grid gap-6 border-t border-border/70 pt-5">
              <CurrencySetup
                settings={settings}
                onCurrencyChange={(currency) => {
                  onSettingsChange(selectPriceCalculatorCurrency(settings, currency))
                  if (!electricityPresetsAvailable(currency)) onElectricityModeChange('custom')
                }}
              />
              <EquipmentSetup settings={settings} printerFixed={scope?.printerFixed} onSettingsChange={onSettingsChange} />
              <MaterialSetup
                settings={settings}
                consumables={consumables}
                mode={resinMode}
                onModeChange={onResinModeChange}
                onSettingsChange={onSettingsChange}
              />
              <ElectricitySetup
                settings={settings}
                mode={electricityMode}
                onModeChange={onElectricityModeChange}
                onSettingsChange={onSettingsChange}
              />
              <PricingSetup settings={settings} consumables={consumables} onSettingsChange={onSettingsChange} />
            </div>
            <SettingsActions className="border-t border-border/70 pt-4">
              <Button type="submit" disabled={saving || !dirty}>
                {saving && <Spinner />} {copy.save}
              </Button>
              {dirty ? (
                <Button type="button" variant="ghost" disabled={saving} onClick={onDiscard}>
                  {copy.discard}
                </Button>
              ) : (
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                  {copy.done}
                </Button>
              )}
              {dirty && <span className="text-sm text-muted-foreground">{copy.unsaved}</span>}
              {error != null && <FieldError>{error instanceof Error ? error.message : copy.saveError}</FieldError>}
            </SettingsActions>
          </>
        )}
      </SettingsSection>
    </form>
  )
}

function ScopeNotice({ scope }: { scope: SetupScope }) {
  const copy = useI18n().t.calculator.setup.scope
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/70 bg-muted/40 px-3 py-2 text-sm">
      <p className="min-w-0 flex-[1_1_12rem] text-muted-foreground">
        {scope.ownCosts ? copy.own(scope.printerName) : copy.shared(scope.printerName)}
      </p>
      {scope.ownCosts && (
        <Button type="button" variant="outline" size="sm" onClick={scope.onUseWorkspaceSetup}>
          {copy.useShared}
        </Button>
      )}
    </div>
  )
}

function SetupSummary({ settings, consumables }: { settings: PriceCalculatorSettings; consumables: Consumable[] }) {
  const { t, locale } = useI18n()
  const symbol = currencySymbol(settings.currency, locale)
  const equipment = settings.printType === 'resin' ? settings.resinEquipment : settings.filamentEquipment
  const printer = equipment.presetIds.map((id) => getPrinterPreset(id)).find((preset) => preset !== undefined)
  const resin = getResinPreset(settings.resinPresetId)
  const material = chosenMaterial(settings, consumables)
  const country = getElectricityPricePreset(settings.electricityCountryCode)
  const items = [
    { label: t.calculator.currency.title, value: settings.currency },
    {
      label: t.calculator.setup.summary.printer,
      value: printer ? `${printer.brand} ${printer.model}` : `${formatNumber(equipment.printPowerWatts, locale)} W`,
    },
    {
      label: t.calculator.material.title,
      value: material
        ? material.name
        : settings.printType === 'filament'
          ? `${symbol}${formatNumber(settings.filamentPricePerKg, locale)}/kg`
          : `${resin ? `${resin.brand} ${resin.name} · ` : ''}${symbol}${formatNumber(settings.resinPricePerLitre, locale)}/L`,
    },
    {
      label: t.calculator.electricity.title,
      value: `${country ? `${countryFlag(country.countryCode)} ` : ''}${symbol}${formatNumber(settings.electricityPricePerKwh, locale, 4)}/kWh`,
    },
    { label: t.calculator.setup.summary.labour, value: `${symbol}${formatNumber(settings.labourCostPerHour, locale)}/h` },
    { label: t.calculator.setup.summary.margin, value: `${formatNumber(settings.standardMarginPercent, locale)}%` },
  ]
  return (
    <dl className="grid min-w-0 flex-1 grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-x-5 gap-y-3">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="font-heading text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{item.label}</dt>
          <dd className="mt-1 truncate font-mono text-sm" title={item.value}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
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
  consumables,
  mode,
  onModeChange,
  onSettingsChange,
}: {
  settings: PriceCalculatorSettings
  consumables: Consumable[]
  mode: SetupMode
  onModeChange: (mode: SetupMode) => void
  onSettingsChange: (settings: PriceCalculatorSettings) => void
}) {
  const { t, locale } = useI18n()
  const copy = t.calculator.material
  const selectedResin = getResinPreset(settings.resinPresetId)
  const symbol = currencySymbol(settings.currency, locale)
  const material = chosenMaterial(settings, consumables)
  return (
    <SetupGroup
      title={copy.title}
      description={settings.printType === 'resin' ? copy.resinDescription : copy.filamentDescription}
      action={
        settings.printType === 'resin' && !material ? (
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
      <LibraryMaterial settings={settings} consumables={consumables} onSettingsChange={onSettingsChange} />
      {!material && (
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
      )}
    </SetupGroup>
  )
}

// Base UI reserves an empty value for no selection, so entering the price by hand needs its own value.
const ENTERED_MATERIAL = 'entered'

function chosenMaterial(settings: PriceCalculatorSettings, consumables: Consumable[]) {
  return settings.printType === 'resin'
    ? consumablesOfKind(consumables, 'resin').find(({ id }) => id === settings.resinConsumableId)
    : consumablesOfKind(consumables, 'filament').find(({ id }) => id === settings.filamentConsumableId)
}

function LibraryMaterial({
  settings,
  consumables,
  onSettingsChange,
}: {
  settings: PriceCalculatorSettings
  consumables: Consumable[]
  onSettingsChange: (settings: PriceCalculatorSettings) => void
}) {
  const { t, locale } = useI18n()
  const copy = t.calculator.material
  const library = consumablesOfKind(consumables, settings.printType)
  if (!library.length) return null
  const material = chosenMaterial(settings, consumables)
  const options = [{ value: ENTERED_MATERIAL, label: copy.enterHere }, ...library.map((item) => ({ value: item.id, label: item.name }))]
  const money = (value: number) => formatMoney(value, settings.currency, locale)
  const select = (value: string | null) => {
    const id = value && value !== ENTERED_MATERIAL ? value : undefined
    onSettingsChange(settings.printType === 'resin' ? { ...settings, resinConsumableId: id } : { ...settings, filamentConsumableId: id })
  }
  return (
    <Field>
      <FieldLabel htmlFor="calculator-material-consumable">{copy.fromConsumables}</FieldLabel>
      <Select items={options} value={material?.id ?? ENTERED_MATERIAL} onValueChange={select}>
        <SelectTrigger className="w-full" id="calculator-material-consumable">
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
      {material && (
        <FieldDescription>
          {material.kind === 'resin'
            ? copy.libraryResin(money(material.pricePerLitre), formatNumber(material.densityGramsPerMl, locale))
            : material.kind === 'filament'
              ? copy.libraryFilament(money(material.pricePerKg))
              : null}
        </FieldDescription>
      )}
    </Field>
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
  consumables,
  onSettingsChange,
}: {
  settings: PriceCalculatorSettings
  consumables: Consumable[]
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
      <WearParts settings={settings} consumables={consumables} onSettingsChange={onSettingsChange} />
    </SetupGroup>
  )
}

function WearParts({
  settings,
  consumables,
  onSettingsChange,
}: {
  settings: PriceCalculatorSettings
  consumables: Consumable[]
  onSettingsChange: (settings: PriceCalculatorSettings) => void
}) {
  const { t, locale } = useI18n()
  const copy = t.calculator.pricing
  const parts = wearPartsFor(consumables, settings.printType)
  const equipment = equipmentSettingsFor(settings)
  const money = (value: number) => formatMoney(value, settings.currency, locale)
  const manage = (
    <Link to="/settings/$section" params={{ section: 'consumables' }} className="underline underline-offset-2">
      {copy.manageConsumables}
    </Link>
  )
  if (!parts.length) {
    return (
      <p className="text-xs text-muted-foreground">
        {copy.noWearParts} {manage}.
      </p>
    )
  }
  const toggle = (id: string, checked: boolean) =>
    onSettingsChange(
      updateEquipmentSettings(settings, {
        ...equipment,
        partIds: checked ? [...equipment.partIds, id] : equipment.partIds.filter((partId) => partId !== id),
      }),
    )
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">{copy.wearParts}</legend>
      {parts.map((part) => (
        <label key={part.id} className="flex items-center gap-2 text-sm">
          <Checkbox checked={equipment.partIds.includes(part.id)} onCheckedChange={(checked) => toggle(part.id, checked)} />
          <span className="min-w-0 flex-1 truncate">{part.name}</span>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {part.lifespanUnit === 'plates'
              ? t.settings.consumables.parts.perPlate(money(partCostPerPlate(part)))
              : t.settings.consumables.parts.perHour(money(partCostPerHour(part)))}
          </span>
        </label>
      ))}
      <p className="text-xs text-muted-foreground">
        {copy.wearPartsHint} {manage}
      </p>
    </fieldset>
  )
}
