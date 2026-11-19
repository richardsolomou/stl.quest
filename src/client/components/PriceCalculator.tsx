import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import {
  calculatePrintPrice,
  selectPriceCalculatorPrintType,
  type PriceCalculatorJob,
  type PriceCalculatorSettings,
} from '../../core/priceCalculator'
import { savePriceCalculatorSettings } from '../../server/fns'
import type { calculatorPrefill } from '../calculatorSearch'
import { useI18n } from '../i18n'
import { priceCalculatorSettingsQuery } from '../queries'
import { QueryState } from './QueryState'
import { JobSection } from './priceCalculator/JobSection'
import { QuoteSection, type PriceMode } from './priceCalculator/QuoteSection'
import { SetupForm } from './priceCalculator/SetupForm'
import type { SetupMode } from './priceCalculator/fields'
import { PageHeader, SettingsPage } from './settings/SettingsLayout'

const emptyJob: PriceCalculatorJob = {
  materialAmount: 0,
  materialUnit: 'ml',
  printHours: 0,
  plates: 1,
  handsOnMinutes: 0,
}

type Prefill = ReturnType<typeof calculatorPrefill>

export function PriceCalculator({ workspaceSlug, prefill }: { workspaceSlug: string; prefill?: Prefill }) {
  const { t } = useI18n()
  const query = useQuery(priceCalculatorSettingsQuery(workspaceSlug))
  if (!query.data) {
    return (
      <SettingsPage>
        <PageHeader title={t.calculator.title} description={t.calculator.loadingDescription} />
        <QueryState
          loading={query.isPending}
          error={query.error}
          loadingLabel={t.calculator.loading}
          errorTitle={t.calculator.loadError}
          onRetry={() => void query.refetch()}
        />
      </SettingsPage>
    )
  }
  return (
    <LoadedPriceCalculator workspaceSlug={workspaceSlug} savedSettings={query.data.settings} saved={query.data.saved} prefill={prefill} />
  )
}

function LoadedPriceCalculator({
  workspaceSlug,
  savedSettings,
  saved,
  prefill,
}: {
  workspaceSlug: string
  savedSettings: PriceCalculatorSettings
  saved: boolean
  prefill?: Prefill
}) {
  const { t } = useI18n()
  const [settings, setSettings] = useState(() =>
    prefill ? selectPriceCalculatorPrintType(savedSettings, prefill.printType) : savedSettings,
  )
  const [job, setJob] = useState(() => (prefill ? { ...emptyJob, ...prefill.job } : emptyJob))
  const syncedSettings = useRef(savedSettings)
  const [priceMode, setPriceMode] = useState<PriceMode>('standard')
  const [setupOpen, setSetupOpen] = useState(!saved)
  const [resinMode, setResinMode] = useState<SetupMode>(savedSettings.resinPresetId ? 'preset' : 'custom')
  const [electricityMode, setElectricityMode] = useState<SetupMode>(savedSettings.electricityCountryCode ? 'preset' : 'custom')
  const callSave = useServerFn(savePriceCalculatorSettings)
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: callSave,
    onSuccess: (stored) => {
      setSettings(stored)
      setSetupOpen(false)
      queryClient.setQueryData(priceCalculatorSettingsQuery(workspaceSlug).queryKey, { settings: stored, saved: true })
    },
  })
  // Only a later save resyncs, so a prefilled print type survives the first render.
  useEffect(() => {
    if (syncedSettings.current === savedSettings) return
    syncedSettings.current = savedSettings
    setSettings(savedSettings)
    setResinMode(savedSettings.resinPresetId ? 'preset' : 'custom')
    setElectricityMode(savedSettings.electricityCountryCode ? 'preset' : 'custom')
  }, [savedSettings])

  const result = calculatePrintPrice(settings, job)
  // The job's print type is remembered on save but is a job choice, so switching it alone is not an unsaved setup change.
  // A never-saved setup is the defaults, and saving is how the operator accepts them.
  const setupDirty = !saved || JSON.stringify({ ...settings, printType: savedSettings.printType }) !== JSON.stringify(savedSettings)
  const selectPrintType = (printType: PriceCalculatorSettings['printType']) => {
    setSettings((current) => selectPriceCalculatorPrintType(current, printType))
    setJob((current) => ({ ...current, materialAmount: 0, materialUnit: printType === 'resin' ? 'ml' : 'g' }))
  }

  return (
    <SettingsPage>
      <PageHeader title={t.calculator.title} description={t.calculator.description} />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,0.8fr)]">
        <JobSection settings={settings} job={job} result={result} onJobChange={setJob} onPrintTypeChange={selectPrintType} />
        <QuoteSection settings={settings} job={job} result={result} mode={priceMode} onModeChange={setPriceMode} />
        <SetupForm
          settings={settings}
          resinMode={resinMode}
          electricityMode={electricityMode}
          dirty={setupDirty}
          saving={mutation.isPending}
          error={mutation.error}
          open={setupOpen}
          onOpenChange={setSetupOpen}
          onSettingsChange={setSettings}
          onResinModeChange={setResinMode}
          onElectricityModeChange={setElectricityMode}
          onSave={() => mutation.mutate({ data: { workspaceSlug, ...settings } })}
          onDiscard={() => {
            // Discarding keeps the job's print type, which lives in the same settings object.
            setSettings(selectPriceCalculatorPrintType(savedSettings, settings.printType))
            setResinMode(savedSettings.resinPresetId ? 'preset' : 'custom')
            setElectricityMode(savedSettings.electricityCountryCode ? 'preset' : 'custom')
            mutation.reset()
          }}
        />
      </div>
    </SettingsPage>
  )
}
