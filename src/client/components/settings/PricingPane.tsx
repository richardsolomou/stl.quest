import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getElectricityPricePreset } from '../../../core/electricityPresets'
import {
  electricityPresetsAvailable,
  PRICE_CALCULATOR_CURRENCIES,
  PRICE_CALCULATOR_MAXIMUMS,
  profitSharePercent,
  selectPriceCalculatorCurrency,
  type PriceCalculatorSettings,
  validPriceCalculatorSettings,
} from '../../../core/priceCalculator'
import { savePriceCalculatorSettings } from '../../../server/fns'
import { useI18n } from '../../i18n'
import { catalogueQuery, priceCalculatorSettingsQuery } from '../../queries'
import { useAutosavedDraft, type FocusBinding } from '../../useAutosave'
import { useWorkspaceSlug } from '../../workspace'
import { FilterCombobox } from '../FilterCombobox'
import { QueryState } from '../QueryState'
import { ModeSelector, NumberSetting, type SetupMode } from '../priceCalculator/fields'
import {
  countryFlag,
  countryName,
  currencyLabel,
  currencySymbol,
  electricitySourceLabel,
  formatEurosPerKwh,
  formatNumber,
} from '../priceCalculator/format'
import { PageHeader, SettingsPage, SettingsSection } from './SettingsLayout'

export function PricingPane() {
  const { t } = useI18n()
  const workspaceSlug = useWorkspaceSlug()
  const query = useQuery(priceCalculatorSettingsQuery(workspaceSlug))
  // Loaded with the rates, so the electricity field does not change shape once its countries arrive.
  const electricity = useQuery(catalogueQuery('electricity'))
  const copy = t.settings.pricing
  return (
    <SettingsPage>
      <PageHeader
        title={copy.title}
        description={
          <>
            {copy.description} {copy.elsewhere}{' '}
            {(['printers', 'consumables', 'equipment'] as const).map((section, index) => (
              <span key={section}>
                {index > 0 && ' · '}
                <Link to="/settings/$section" params={{ section }} className="font-medium text-foreground underline underline-offset-2">
                  {copy.links[section]}
                </Link>
              </span>
            ))}
          </>
        }
      />
      {query.data && !electricity.isPending ? (
        <PricingForm workspaceSlug={workspaceSlug} stored={query.data.settings} />
      ) : (
        <QueryState
          loading={query.isPending || electricity.isPending}
          error={query.error}
          loadingLabel={t.calculator.loading}
          errorTitle={t.calculator.loadError}
          onRetry={() => void query.refetch()}
        />
      )}
    </SettingsPage>
  )
}

type SettingsChange = (settings: PriceCalculatorSettings) => void

/** The rates as one draft that saves itself; a figure out of range is shown as such and not saved. */
function PricingForm({ workspaceSlug, stored }: { workspaceSlug: string; stored: PriceCalculatorSettings }) {
  const callSave = useServerFn(savePriceCalculatorSettings)
  const queryClient = useQueryClient()
  const {
    draft: settings,
    setDraft: setSettings,
    bind,
  } = useAutosavedDraft(stored, {
    valid: validPriceCalculatorSettings,
    save: async (value) => {
      const next = await callSave({ data: { workspaceSlug, ...value } })
      queryClient.setQueryData(priceCalculatorSettingsQuery(workspaceSlug).queryKey, { settings: next, saved: true })
    },
  })
  const [electricityMode, setElectricityMode] = useState<SetupMode>(stored.electricityCountryCode ? 'preset' : 'custom')
  return (
    <>
      <CurrencySection
        bind={bind}
        settings={settings}
        onChange={(currency) => {
          setSettings(selectPriceCalculatorCurrency(settings, currency))
          if (!electricityPresetsAvailable(currency)) setElectricityMode('custom')
        }}
      />
      <ElectricitySection
        bind={bind}
        settings={settings}
        mode={electricityMode}
        onModeChange={setElectricityMode}
        onSettingsChange={setSettings}
      />
      <LabourSection bind={bind} settings={settings} onSettingsChange={setSettings} />
    </>
  )
}

function CurrencySection({
  bind,
  settings,
  onChange,
}: {
  bind: FocusBinding
  settings: PriceCalculatorSettings
  onChange: (currency: PriceCalculatorSettings['currency']) => void
}) {
  const { t, locale } = useI18n()
  const copy = t.calculator.currency
  const options = useMemo(
    () => PRICE_CALCULATOR_CURRENCIES.map((currency) => ({ value: currency, label: currencyLabel(currency, locale) })),
    [locale],
  )
  return (
    <SettingsSection {...bind} title={copy.title} description={copy.description}>
      <Field>
        <FieldLabel htmlFor="calculator-currency">{copy.label}</FieldLabel>
        <Select items={options} value={settings.currency} onValueChange={(currency) => currency && onChange(currency)}>
          <SelectTrigger className="w-full sm:w-80" id="calculator-currency">
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
    </SettingsSection>
  )
}

function ElectricitySection({
  bind,
  settings,
  mode,
  onModeChange,
  onSettingsChange,
}: {
  bind: FocusBinding
  settings: PriceCalculatorSettings
  mode: SetupMode
  onModeChange: (mode: SetupMode) => void
  onSettingsChange: SettingsChange
}) {
  const { t, locale } = useI18n()
  const copy = t.calculator.electricity
  const presets = useQuery(catalogueQuery('electricity')).data
  const options = useMemo(
    () =>
      (presets ?? []).map((preset) => {
        const name = countryName(preset, locale)
        return {
          value: preset.countryCode,
          label: `${countryFlag(preset.countryCode)} ${name} · ${formatEurosPerKwh(preset.eurPerKwh, locale)}`,
          countryName: name,
        }
      }),
    [presets, locale],
  )
  const selected = getElectricityPricePreset(presets, settings.electricityCountryCode)
  const presetsAvailable = electricityPresetsAvailable(settings.currency)
  return (
    <SettingsSection {...bind} title={copy.title} description={presetsAvailable ? copy.presetsDescription : copy.customDescription}>
      {presetsAvailable && (
        <div className="self-start">
          <ModeSelector
            legend={copy.modeLegend}
            value={mode}
            onChange={(next) => {
              onModeChange(next)
              if (next === 'custom') onSettingsChange({ ...settings, electricityCountryCode: undefined })
            }}
          />
        </div>
      )}
      {presetsAvailable && mode === 'preset' ? (
        <Field>
          <FieldLabel htmlFor="calculator-electricity-country">{copy.countryPreset}</FieldLabel>
          <FilterCombobox
            id="calculator-electricity-country"
            value={settings.electricityCountryCode}
            options={options}
            placeholder={copy.countrySearch}
            emptyLabel={copy.countryEmpty}
            optionAriaLabel={(option) => option.countryName}
            onChange={(electricityCountryCode) => {
              const preset = getElectricityPricePreset(presets, electricityCountryCode)
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
              copy.presetCount(options.length)
            )}
          </FieldDescription>
        </Field>
      ) : (
        <NumberSetting
          label={copy.price(currencySymbol(settings.currency, locale))}
          value={settings.electricityPricePerKwh}
          min={0}
          max={PRICE_CALCULATOR_MAXIMUMS.electricityPricePerKwh}
          onChange={(electricityPricePerKwh) => onSettingsChange({ ...settings, electricityPricePerKwh })}
          description={copy.priceHint}
        />
      )}
    </SettingsSection>
  )
}

function LabourSection({
  bind,
  settings,
  onSettingsChange,
}: {
  bind: FocusBinding
  settings: PriceCalculatorSettings
  onSettingsChange: SettingsChange
}) {
  const { t, locale } = useI18n()
  const copy = t.calculator.pricing
  return (
    <SettingsSection {...bind} title={copy.businessTitle} description={copy.businessDescription}>
      <div className="grid gap-4 sm:grid-cols-3">
        <NumberSetting
          label={copy.labour(currencySymbol(settings.currency, locale))}
          value={settings.labourCostPerHour}
          min={0}
          max={PRICE_CALCULATOR_MAXIMUMS.labourCostPerHour}
          onChange={(labourCostPerHour) => onSettingsChange({ ...settings, labourCostPerHour })}
        />
        <NumberSetting
          label={copy.failureAllowance}
          value={settings.failureAllowancePercent}
          min={0}
          max={PRICE_CALCULATOR_MAXIMUMS.failureAllowancePercent}
          onChange={(failureAllowancePercent) => onSettingsChange({ ...settings, failureAllowancePercent })}
        />
        <NumberSetting
          label={copy.markup}
          description={copy.markupHint(
            formatNumber(settings.markupPercent, locale),
            formatNumber(profitSharePercent(settings.markupPercent), locale, 1),
          )}
          value={settings.markupPercent}
          min={0}
          max={PRICE_CALCULATOR_MAXIMUMS.markupPercent}
          onChange={(markupPercent) => onSettingsChange({ ...settings, markupPercent })}
        />
      </div>
    </SettingsSection>
  )
}
