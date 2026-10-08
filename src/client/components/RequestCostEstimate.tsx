import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Calculator } from 'lucide-react'
import { priceRequest } from '../../core/priceCalculator'
import type { PublicPrintRequest } from '../../core/types'
import { calculatorSearch } from '../calculatorSearch'
import { priceCalculatorSettingsQuery } from '../queries'
import { useWorkspaceSlug } from '../workspace'
import { requestPrintEstimate } from './PrintEstimate'
import { formatEuros } from './priceCalculator/format'

/** Admin-only: the calculator setup is private to admins, and the default rates would price work nobody configured. */
export function RequestCostEstimate({ request }: { request: PublicPrintRequest }) {
  const workspaceSlug = useWorkspaceSlug()
  const query = useQuery(priceCalculatorSettingsQuery(workspaceSlug))
  const estimate = requestPrintEstimate(request)
  if (!request.printType || !estimate || !query.data?.saved) return null
  const quote = priceRequest(query.data.settings, { ...estimate, printType: request.printType, quantity: request.quantity })
  if (!quote) return null
  return (
    <div className="mb-3">
      <div className="mb-1 text-xs text-muted-foreground">Estimated cost</div>
      <p className="text-sm">
        <strong>{formatEuros(quote.result.costPrice)}</strong>{' '}
        <span className="text-muted-foreground">
          · {formatEuros(quote.result.standardPrice)} suggested{request.quantity > 1 && ` for all ${request.quantity} copies`}
        </span>
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        From your saved calculator setup, assuming one plate per copy and no hands-on time.
        <Link
          to="/calculator"
          search={calculatorSearch(request.printType, quote.job)}
          className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-4 hover:text-primary/80"
        >
          <Calculator className="size-3.5" />
          Open in calculator
        </Link>
      </p>
    </div>
  )
}
