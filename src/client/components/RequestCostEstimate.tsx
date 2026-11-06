import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Calculator } from 'lucide-react'
import { priceRequest } from '../../core/priceCalculator'
import type { PublicPrintRequest } from '../../core/types'
import { calculatorSearch } from '../calculatorSearch'
import { priceCalculatorSettingsQuery } from '../queries'
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
  const estimate = requestPrintEstimate(request)
  if (!request.printType || !estimate || !query.data?.saved) return null
  const quote = priceRequest(query.data.settings, { ...estimate, printType: request.printType, quantity: request.quantity })
  if (!quote) return null
  const { currency } = query.data.settings
  return (
    <DetailRow label={t.requests.cost.label}>
      <strong>{formatMoney(quote.result.costPrice, currency, locale)}</strong>{' '}
      <span className="text-muted-foreground">
        · {t.requests.cost.suggested(formatMoney(quote.result.standardPrice, currency, locale), request.quantity)}
      </span>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {t.requests.cost.hint}{' '}
        <Link
          to="/calculator"
          search={calculatorSearch(request.printType, quote.job)}
          className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-4 hover:text-primary/80"
        >
          <Calculator className="size-3.5" />
          {t.requests.cost.openCalculator}
        </Link>
      </p>
    </DetailRow>
  )
}
