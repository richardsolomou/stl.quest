import { Link } from '@tanstack/react-router'
import { Settings2 } from 'lucide-react'
import type { PriceCalculatorSettings } from '../../../core/priceCalculator'
import { useI18n } from '../../i18n'
import { TypicalTag } from './CostBasis'
import { currencySymbol, formatNumber } from './format'

/** The business rates every quote shares, and the way to change them; never-saved defaults say so. */
export function RatesLink({ settings, saved }: { settings: PriceCalculatorSettings; saved: boolean }) {
  const { t, locale } = useI18n()
  const copy = t.calculator.rates
  const symbol = currencySymbol(settings.currency, locale)
  const percent = (value: number) => `${formatNumber(value, locale)}%`
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border/70 pt-3 text-xs text-muted-foreground">
      <span className="min-w-0">
        {copy.summary(
          `${symbol}${formatNumber(settings.labourCostPerHour, locale)}/h`,
          percent(settings.failureAllowancePercent),
          percent(settings.standardMarginPercent),
        )}
        {!saved && <TypicalTag label={copy.defaults} />}
      </span>
      <Link
        to="/settings/$section"
        params={{ section: 'pricing' }}
        className="inline-flex items-center gap-1 font-medium text-foreground underline decoration-primary decoration-2 underline-offset-4 hover:decoration-foreground"
      >
        <Settings2 className="size-3.5" />
        {copy.edit}
      </Link>
    </div>
  )
}
