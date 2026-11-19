import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import {
  calculatePrintPrice,
  printerCostSettings,
  removePrinterCosts,
  selectPriceCalculatorPrintType,
  withConsumables,
  withPrinterCostSettings,
  type PriceCalculatorJob,
  type PriceCalculatorSettings,
} from '../../core/priceCalculator'
import { getPrinterPreset } from '../../core/printerPresets'
import type { PrinterProfile } from '../../core/types'
import { savePriceCalculatorSettings } from '../../server/fns'
import type { calculatorPrefill } from '../calculatorSearch'
import { useI18n } from '../i18n'
import { consumablesQuery, priceCalculatorSettingsQuery, printersQuery } from '../queries'
import type { Consumable } from '../../core/consumables'
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
  const printers = useQuery(printersQuery(workspaceSlug)).data?.profiles.filter((printer) => !printer.archived) ?? []
  const consumables = useQuery(consumablesQuery(workspaceSlug)).data?.consumables ?? []
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
    <LoadedPriceCalculator
      workspaceSlug={workspaceSlug}
      savedSettings={query.data.settings}
      saved={query.data.saved}
      printers={printers}
      consumables={consumables}
      prefill={prefill}
    />
  )
}

function LoadedPriceCalculator({
  workspaceSlug,
  savedSettings,
  saved,
  printers,
  consumables,
  prefill,
}: {
  workspaceSlug: string
  savedSettings: PriceCalculatorSettings
  saved: boolean
  printers: PrinterProfile[]
  consumables: Consumable[]
  prefill?: Prefill
}) {
  const { t } = useI18n()
  const [settings, setSettings] = useState(() =>
    prefill ? selectPriceCalculatorPrintType(savedSettings, prefill.printType) : savedSettings,
  )
  const [job, setJob] = useState(() => (prefill ? { ...emptyJob, ...prefill.job } : emptyJob))
  // Undefined opens the first printer of the print type; null is the workspace setup chosen explicitly.
  const [printerId, setPrinterId] = useState<string | null | undefined>(prefill?.printerId)
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

  const choices = printers.filter((printer) => printer.printType === settings.printType)
  const printer =
    printerId === null
      ? undefined
      : (choices.find((choice) => choice.id === printerId) ?? (printerId === undefined ? choices[0] : undefined))
  const ownCosts = printer !== undefined && settings.printerCosts[printer.id] !== undefined
  // The form and quote see the selected printer's view; edits are split back into its own costs and the shared setup.
  const scoped = printer ? printerCostSettings(settings, printer) : settings
  const result = calculatePrintPrice(withConsumables(scoped, consumables), job)
  const comparison = choices.map((choice) => ({
    printer: choice,
    result: calculatePrintPrice(withConsumables(printerCostSettings(settings, choice), consumables), job),
  }))
  const syncResinMode = (next: PriceCalculatorSettings) => setResinMode(next.resinPresetId ? 'preset' : 'custom')
  const selectPrinter = (id: string | undefined) => setPrinterId(id ?? null)
  // The resin preset toggle follows whichever setup is shown, including the default printer once the fleet loads.
  const [resinModeScope, setResinModeScope] = useState(printer?.id)
  if (resinModeScope !== printer?.id) {
    setResinModeScope(printer?.id)
    syncResinMode(scoped)
  }
  const followWorkspaceSetup = () => {
    if (!printer) return
    const next = removePrinterCosts(settings, printer.id)
    setSettings(next)
    syncResinMode(printerCostSettings(next, printer))
  }
  // The job's print type is remembered on save but is a job choice, so switching it alone is not an unsaved setup change.
  // A never-saved setup is the defaults, and saving is how the operator accepts them.
  const setupDirty = !saved || JSON.stringify({ ...settings, printType: savedSettings.printType }) !== JSON.stringify(savedSettings)
  const selectPrintType = (printType: PriceCalculatorSettings['printType']) => {
    setSettings((current) => selectPriceCalculatorPrintType(current, printType))
    setPrinterId(undefined)
    setJob((current) => ({ ...current, materialAmount: 0, materialUnit: printType === 'resin' ? 'ml' : 'g' }))
  }

  return (
    <SettingsPage>
      <PageHeader title={t.calculator.title} description={t.calculator.description} />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,0.8fr)]">
        <JobSection
          settings={scoped}
          job={job}
          result={result}
          printers={choices}
          printerId={printer?.id}
          onJobChange={setJob}
          onPrintTypeChange={selectPrintType}
          onPrinterChange={selectPrinter}
        />
        <QuoteSection
          settings={scoped}
          job={job}
          result={result}
          mode={priceMode}
          comparison={comparison}
          printerId={printer?.id}
          onModeChange={setPriceMode}
          onPrinterChange={selectPrinter}
        />
        <SetupForm
          settings={scoped}
          consumables={consumables}
          scope={
            printer && {
              printerName: printer.name,
              printerFixed: Boolean(getPrinterPreset(printer.presetId)),
              ownCosts,
              onUseWorkspaceSetup: followWorkspaceSetup,
            }
          }
          resinMode={resinMode}
          electricityMode={electricityMode}
          dirty={setupDirty}
          saving={mutation.isPending}
          error={mutation.error}
          open={setupOpen}
          onOpenChange={setSetupOpen}
          onSettingsChange={(edited) => setSettings((current) => (printer ? withPrinterCostSettings(current, printer, edited) : edited))}
          onResinModeChange={setResinMode}
          onElectricityModeChange={setElectricityMode}
          onSave={() => mutation.mutate({ data: { workspaceSlug, ...settings } })}
          onDiscard={() => {
            // Discarding keeps the job's print type, which lives in the same settings object.
            const restored = selectPriceCalculatorPrintType(savedSettings, settings.printType)
            setSettings(restored)
            syncResinMode(printer ? printerCostSettings(restored, printer) : restored)
            setElectricityMode(savedSettings.electricityCountryCode ? 'preset' : 'custom')
            mutation.reset()
          }}
        />
      </div>
    </SettingsPage>
  )
}
