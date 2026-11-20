import { Link } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import { useI18n } from '../../i18n'

/** Switches between quoting a job and what past jobs actually spent; both live under the one Calculator destination. */
export function CalculatorTabs({ active }: { active: 'quote' | 'spend' }) {
  const { t } = useI18n()
  const tab = (current: boolean) =>
    cn(
      'inline-flex h-8 items-center rounded-md px-3 text-sm font-medium text-muted-foreground hover:text-foreground',
      current && 'bg-field text-foreground shadow-sm ring-1 ring-input',
    )
  return (
    <nav aria-label={t.spend.tabs.label} className="flex rounded-lg border border-input bg-foreground/5 p-1">
      <Link to="/calculator" className={tab(active === 'quote')} aria-current={active === 'quote' ? 'page' : undefined}>
        {t.spend.tabs.quote}
      </Link>
      <Link to="/calculator/spend" className={tab(active === 'spend')} aria-current={active === 'spend' ? 'page' : undefined}>
        {t.spend.tabs.spend}
      </Link>
    </nav>
  )
}
