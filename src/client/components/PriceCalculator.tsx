import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import {
  calculatePrintPrice,
  selectPriceCalculatorPrintType,
  type PriceCalculatorJob,
  type PriceCalculatorSettings,
} from '../../core/priceCalculator'
import { savePriceCalculatorSettings } from '../../server/fns'
import { priceCalculatorSettingsQuery } from '../queries'
import { QueryState } from './QueryState'
import { JobSection } from './priceCalculator/JobSection'
import { QuoteSection, type PriceMode } from './priceCalculator/QuoteSection'
import { SetupForm } from './priceCalculator/SetupForm'
import type { SetupMode } from './priceCalculator/fields'
import { SettingsHeader, SettingsPage } from './settings/SettingsLayout'

const emptyJob: PriceCalculatorJob = {
  materialAmount: 0,
  materialUnit: 'ml',
  printHours: 0,
  plates: 1,
  handsOnMinutes: 0,
}

export function PriceCalculator({ workspaceSlug }: { workspaceSlug: string }) {
  const query = useQuery(priceCalculatorSettingsQuery(workspaceSlug))
  if (!query.data) {
    return (
      <SettingsPage>
        <SettingsHeader
          title="Print calculator"
          description="Work out a rough resin or FDM print price without attaching it to a request."
        />
        <QueryState
          loading={query.isPending}
          error={query.error}
          loadingLabel="Loading calculator…"
          errorTitle="Could not load the calculator"
          onRetry={() => void query.refetch()}
        />
      </SettingsPage>
    )
  }
  return <LoadedPriceCalculator workspaceSlug={workspaceSlug} savedSettings={query.data} />
}

function LoadedPriceCalculator({ workspaceSlug, savedSettings }: { workspaceSlug: string; savedSettings: PriceCalculatorSettings }) {
  const [settings, setSettings] = useState(savedSettings)
  const [job, setJob] = useState(emptyJob)
  const [priceMode, setPriceMode] = useState<PriceMode>('standard')
  const [resinMode, setResinMode] = useState<SetupMode>(savedSettings.resinPresetId ? 'preset' : 'custom')
  const [electricityMode, setElectricityMode] = useState<SetupMode>(savedSettings.electricityCountryCode ? 'preset' : 'custom')
  const callSave = useServerFn(savePriceCalculatorSettings)
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: callSave,
    onSuccess: (saved) => {
      setSettings(saved)
      queryClient.setQueryData(priceCalculatorSettingsQuery(workspaceSlug).queryKey, saved)
    },
  })
  useEffect(() => {
    setSettings(savedSettings)
    setResinMode(savedSettings.resinPresetId ? 'preset' : 'custom')
    setElectricityMode(savedSettings.electricityCountryCode ? 'preset' : 'custom')
  }, [savedSettings])

  const result = calculatePrintPrice(settings, job)
  const selectPrintType = (printType: PriceCalculatorSettings['printType']) => {
    setSettings((current) => selectPriceCalculatorPrintType(current, printType))
    setJob((current) => ({ ...current, materialAmount: 0, materialUnit: printType === 'resin' ? 'ml' : 'g' }))
  }

  return (
    <SettingsPage>
      <SettingsHeader
        title="Print calculator"
        description="A private pricing scratchpad. Enter the totals from your slicer; nothing here is attached to a request."
      />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,0.8fr)]">
        <JobSection settings={settings} job={job} result={result} onJobChange={setJob} onPrintTypeChange={selectPrintType} />
        <QuoteSection settings={settings} job={job} result={result} mode={priceMode} onModeChange={setPriceMode} />
        <SetupForm
          settings={settings}
          resinMode={resinMode}
          electricityMode={electricityMode}
          dirty={JSON.stringify(settings) !== JSON.stringify(savedSettings)}
          saving={mutation.isPending}
          error={mutation.error}
          onSettingsChange={setSettings}
          onResinModeChange={setResinMode}
          onElectricityModeChange={setElectricityMode}
          onSave={() => mutation.mutate({ data: { workspaceSlug, ...settings } })}
        />
      </div>
    </SettingsPage>
  )
}
