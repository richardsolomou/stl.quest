import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Calculator } from 'lucide-react'
import { printerCostSettings, priceRequest, priceRequestOnPrinters, withConsumables } from '../../core/priceCalculator'
import type { PublicPrintRequest } from '../../core/types'
import { calculatorSearch } from '../calculatorSearch'
import { consumablesQuery, priceCalculatorSettingsQuery, printersQuery } from '../queries'
import { useWorkspaceSlug } from '../workspace'
import { DetailRow } from './DetailRow'
import { requestPrintEstimate } from './PrintEstimate'
import { formatMoney } from './priceCalculator/format'
import { useI18n } from '../i18n'

/** Admin-only: the calculator setup is private to admins, and the default rates would price work nobody configured. */
export function RequestCostEstimate({ request }: { request: PublicPrintRequest }) {
  const { t, locale } = useI18n()
  const workspaceSlug = useWorkspaceSlug()
  const query = useQuery(priceCalculatorSettingsQuery(workspaceSlug))
  const printers = useQuery(printersQuery(workspaceSlug)).data?.profiles ?? []
  const consumables = useQuery(consumablesQuery(workspaceSlug)).data?.consumables ?? []
  const estimate = requestPrintEstimate(request)
  if (!request.printType || !estimate || !query.data?.saved) return null
  const { settings } = query.data
  const input = { ...estimate, printType: request.printType, quantity: request.quantity }
  const assigned = printers.find((printer) => printer.id === request.printer?.id && printer.printType === request.printType)
  const quote = priceRequest(withConsumables(assigned ? printerCostSettings(settings, assigned) : settings, consumables), input)
  if (!quote) return null
  const comparison = priceRequestOnPrinters(settings, printers, input, consumables)
  const money = (value: number) => formatMoney(value, settings.currency, locale)
  return (
    <DetailRow label={t.requests.cost.label}>
      <strong>{money(quote.result.estimatedCost)}</strong>
      {assigned && <span className="text-muted-foreground"> {t.requests.cost.onPrinter(assigned.name)}</span>}{' '}
      <span className="text-muted-foreground">· {t.requests.cost.suggested(money(quote.result.standardPrice), request.quantity)}</span>
      {comparison.length > 1 && (
        <dl className="mt-1.5 grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-xs">
          <dt className="col-span-2 font-medium text-muted-foreground">{t.requests.cost.onEachPrinter}</dt>
          {comparison.map(({ printer, quote: printerQuote }) => (
            <div key={printer.id} className="contents">
              <dt className={printer.id === assigned?.id ? 'font-medium' : 'text-muted-foreground'}>{printer.name}</dt>
              <dd className="font-mono tabular-nums">{printerQuote ? money(printerQuote.result.estimatedCost) : '—'}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className={comparison.length > 1 ? 'mt-1.5 text-xs text-muted-foreground' : 'mt-0.5 text-xs text-muted-foreground'}>
        {t.requests.cost.hint}{' '}
        <Link
          to="/calculator"
          search={calculatorSearch(request.printType, quote.job, assigned?.id)}
          className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-4 hover:text-primary/80"
        >
          <Calculator className="size-3.5" />
          {t.requests.cost.openCalculator}
        </Link>
      </p>
    </DetailRow>
  )
}
