import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Calculator, ChevronRight, Info } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DEFAULT_PRICE_CALCULATOR_SETTINGS, priceRequest, priceRequestOnPrinters } from '../../core/priceCalculator'
import type { PublicPrintRequest } from '../../core/types'
import { calculatorSearch } from '../calculatorSearch'
import { usePricedConsumables } from '../inventory'
import { equipmentQuery, priceCalculatorSettingsQuery, printersQuery } from '../queries'
import { useWorkspaceSlug } from '../workspace'
import { DetailRow } from './DetailRow'
import { requestPrintEstimate } from '../../core/printEstimates'
import { formatMoney } from './priceCalculator/format'
import { useI18n } from '../i18n'

/** Admin-only: the calculator setup is private to admins, and the default rates would price work nobody configured. */
export function RequestCostEstimate({ request }: { request: PublicPrintRequest }) {
  const { t, locale } = useI18n()
  const workspaceSlug = useWorkspaceSlug()
  const query = useQuery(priceCalculatorSettingsQuery(workspaceSlug))
  const printerData = useQuery(printersQuery(workspaceSlug)).data
  const printers = printerData?.profiles ?? []
  const printerRuns = printerData?.runs ?? []
  const consumables = usePricedConsumables(workspaceSlug, query.data?.settings.currency ?? DEFAULT_PRICE_CALCULATOR_SETTINGS.currency)
  const equipment = useQuery(equipmentQuery(workspaceSlug)).data?.equipment ?? []
  const estimate = requestPrintEstimate(request)
  if (!request.printType || !estimate || !query.data?.saved) return null
  const { settings } = query.data
  const input = { ...estimate, printType: request.printType, quantity: request.quantity }
  const assigned = printers.find((printer) => printer.id === request.printer?.id && printer.printType === request.printType)
  const quote = priceRequest({ rates: settings, consumables, printer: assigned, equipment, printerRuns }, input)
  if (!quote) return null
  const comparison = priceRequestOnPrinters(settings, printers, input, consumables, equipment, printerRuns)
  const money = (value: number) => formatMoney(value, settings.currency, locale)
  const others = comparison
    .flatMap(({ printer, quote: printerQuote }) => (printerQuote ? [{ printer, cost: printerQuote.result.estimatedCost }] : []))
    .sort((a, b) => a.cost - b.cost)
  const cheapest = others[0]?.cost
  const dearest = others.at(-1)?.cost
  return (
    <DetailRow label={t.requests.cost.label}>
      <span className="flex items-start gap-1.5">
        <span className="min-w-0">
          <strong className="font-semibold">{money(quote.result.estimatedCost)}</strong>
          {assigned && <span className="text-muted-foreground"> {t.requests.cost.onPrinter(assigned.name)}</span>}
          <span className="block text-xs text-muted-foreground">
            {t.requests.cost.suggested(money(quote.result.suggestedPrice), request.quantity)}
          </span>
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className="mt-0.5 grid size-5 shrink-0 cursor-help place-items-center rounded-full text-muted-foreground hover:text-foreground"
                aria-label={t.requests.cost.hint}
              />
            }
          >
            <Info className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent className="max-w-64">{t.requests.cost.hint}</TooltipContent>
        </Tooltip>
      </span>
      {others.length > 1 && cheapest !== undefined && dearest !== undefined && (
        <details className="group mt-1.5 text-xs">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-3.5 shrink-0 transition-transform group-open:rotate-90" />
            {t.requests.cost.compare(others.length, cheapest === dearest ? money(cheapest) : `${money(cheapest)}–${money(dearest)}`)}
          </summary>
          <dl className="app-scrollbar mt-1 grid max-h-40 grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 overflow-y-auto pl-5">
            {others.map(({ printer, cost }) => (
              <div key={printer.id} className="contents">
                <dt className={printer.id === assigned?.id ? 'font-medium' : 'text-muted-foreground'}>{printer.name}</dt>
                <dd className="font-mono tabular-nums">{money(cost)}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      <Link
        to="/calculator"
        search={calculatorSearch(request.printType, quote.job, assigned?.id)}
        className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-foreground underline decoration-primary decoration-2 underline-offset-4 hover:decoration-foreground"
      >
        <Calculator className="size-3.5" />
        {t.requests.cost.openCalculator}
      </Link>
    </DetailRow>
  )
}
