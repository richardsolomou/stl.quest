import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { consumablesOfKind, type Consumable } from '../../core/consumables'
import { chosenFinishing, servesPrintType, type EquipmentItem } from '../../core/equipment'
import {
  costBasis,
  costPrint,
  DEFAULT_PRICE_CALCULATOR_SETTINGS,
  TYPICAL_JOBS,
  TYPICAL_RESIN_DENSITY_GRAMS_PER_ML,
  type PriceCalculatorJob,
  type PriceCalculatorSettings,
} from '../../core/priceCalculator'
import type { PrinterProfile, PrintType } from '../../core/types'
import type { calculatorPrefill } from '../calculatorSearch'
import { requestPrintTypeChoices } from '../fleet'
import { useI18n } from '../i18n'
import { usePricedConsumables } from '../inventory'
import { equipmentQuery, priceCalculatorSettingsQuery, printersQuery } from '../queries'
import { useWorkspacePrintTypes } from '../workspace'
import { QueryState } from './QueryState'
import { BatchEstimate } from './priceCalculator/BatchEstimate'
import { CalculatorTabs } from './priceCalculator/CalculatorTabs'
import { JobPickers, type JobMaterial } from './priceCalculator/JobPickers'
import { JobSection } from './priceCalculator/JobSection'
import { QuoteSection } from './priceCalculator/QuoteSection'
import { RatesLink } from './priceCalculator/PricingSections'
import { PageHeader, SettingsPage } from './settings/SettingsLayout'

const emptyJob: PriceCalculatorJob = {
  materialAmount: 0,
  materialUnit: 'ml',
  printHours: 0,
  plates: 1,
  handsOnMinutes: 0,
}

type Prefill = ReturnType<typeof calculatorPrefill>

export function PriceCalculator({
  workspaceSlug,
  prefill,
  requestIds,
}: {
  workspaceSlug: string
  prefill?: Prefill
  requestIds: string[]
}) {
  const { t } = useI18n()
  const query = useQuery(priceCalculatorSettingsQuery(workspaceSlug))
  const printers = useQuery(printersQuery(workspaceSlug)).data?.profiles.filter((printer) => !printer.archived) ?? []
  const consumables = usePricedConsumables(workspaceSlug, query.data?.settings.currency ?? DEFAULT_PRICE_CALCULATOR_SETTINGS.currency)
  const equipment = useQuery(equipmentQuery(workspaceSlug)).data?.equipment.filter((item) => !item.archived) ?? []
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
  if (requestIds.length > 0) {
    return (
      <BatchEstimate
        requestIds={requestIds}
        settings={query.data.settings}
        saved={query.data.saved}
        printers={printers}
        consumables={consumables}
        equipment={equipment}
      />
    )
  }
  return (
    <LoadedPriceCalculator
      rates={query.data.settings}
      saved={query.data.saved}
      printers={printers}
      consumables={consumables}
      equipment={equipment}
      prefill={prefill}
    />
  )
}

// Undefined picks the first of the print type; null is nothing picked, which prices with typical values.
type Choice = string | null | undefined

function picked<Item extends { id: string }>(items: Item[], id: Choice) {
  return id === null ? undefined : (items.find((item) => item.id === id) ?? (id === undefined ? items[0] : undefined))
}

function LoadedPriceCalculator({
  rates,
  saved,
  printers,
  consumables,
  equipment,
  prefill,
}: {
  rates: PriceCalculatorSettings
  saved: boolean
  printers: PrinterProfile[]
  consumables: Consumable[]
  equipment: EquipmentItem[]
  prefill?: Prefill
}) {
  const { t } = useI18n()
  // A print being priced keeps its own type even when the workspace no longer prints it.
  const printTypes = requestPrintTypeChoices(useWorkspacePrintTypes(), prefill?.printType)
  const [printType, setPrintType] = useState<PrintType>(prefill?.printType ?? printTypes[0])
  const [job, setJob] = useState(() => (prefill ? { ...emptyJob, ...prefill.job } : emptyJob))
  const [printerId, setPrinterId] = useState<Choice>(prefill?.printerId)
  const [materialId, setMaterialId] = useState<Choice>()
  // Undefined counts the workspace's own wash and cure until the user picks.
  const [equipmentIds, setEquipmentIds] = useState<string[]>()
  const choices = printers.filter((printer) => printer.printType === printType)
  const printer = picked(choices, printerId)
  const materials: JobMaterial[] = consumablesOfKind(consumables, printType)
  const material = picked(materials, materialId)
  const usable = equipment.filter((item) => servesPrintType(item, printType))
  const chosenEquipment = chosenFinishing(usable, printType, equipmentIds)
  const picks = { rates, printType, consumables, material, equipment: chosenEquipment }
  const cost = (on?: PrinterProfile) => costPrint({ ...picks, job, printer: on })
  const result = cost(printer)
  const basis = costBasis({ ...picks, printer })
  const comparison = choices.map((choice) => ({ printer: choice, result: cost(choice) }))
  const selectPrinter = (id: string | undefined) => setPrinterId(id ?? null)
  const selectPrintType = (next: PrintType) => {
    setPrintType(next)
    setPrinterId(undefined)
    setMaterialId(undefined)
    setEquipmentIds(undefined)
    setJob((current) => ({ ...current, materialAmount: 0, materialUnit: next === 'resin' ? 'ml' : 'g' }))
  }

  return (
    <SettingsPage>
      <PageHeader title={t.calculator.title} description={t.calculator.description} actions={<CalculatorTabs active="quote" />} />
      {/* Phones read setup, quote, then job; wide screens keep the quote sticky beside both. The 1fr row takes the quote's extra height, so the job stays under the setup. */}
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,0.8fr)] lg:grid-rows-[auto_1fr]">
        <JobPickers
          printType={printType}
          printTypes={printTypes}
          currency={rates.currency}
          printers={choices}
          printer={printer}
          materials={materials}
          material={material}
          equipment={usable}
          chosenEquipment={chosenEquipment}
          onPrintTypeChange={selectPrintType}
          onPrinterChange={selectPrinter}
          onMaterialChange={(id) => setMaterialId(id ?? null)}
          onEquipmentChange={setEquipmentIds}
        />
        <QuoteSection
          rates={rates}
          printType={printType}
          job={job}
          result={result}
          basis={basis}
          comparison={comparison}
          printer={printer}
          materialName={material?.name}
          onPrinterChange={selectPrinter}
          onTryTypicalJob={() => setJob(TYPICAL_JOBS[printType])}
          rateLink={<RatesLink settings={rates} saved={saved} />}
        />
        <JobSection
          printType={printType}
          job={job}
          result={result}
          density={material?.kind === 'resin' ? material.densityGramsPerMl : TYPICAL_RESIN_DENSITY_GRAMS_PER_ML}
          onJobChange={setJob}
        />
      </div>
    </SettingsPage>
  )
}
