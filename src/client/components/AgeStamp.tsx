import { cn } from '@/lib/utils'
import { ageUnit, isAgeHot } from '../../core/requestAge'
import { useI18n } from '../i18n'
import { useNow } from '../useNow'

const formatters = new Map<string, Intl.NumberFormat>()

/** Formatters are costly to build and a busy board renders hundreds of ages a minute, so each locale and unit builds once. */
function formatAge(locale: string, unit: string, unitDisplay: 'narrow' | 'long', value: number) {
  const key = `${locale}|${unit}|${unitDisplay}`
  let formatter = formatters.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay })
    formatters.set(key, formatter)
  }
  return formatter.format(value)
}

/** How long a ticket has waited, in a few characters, turning red once it has waited too long. */
export function AgeStamp({ since, label, className }: { since: number; label: (age: string) => string; className?: string }) {
  const { locale } = useI18n()
  const now = useNow()
  if (now === undefined) return null
  const elapsed = now - since
  const { value, unit } = ageUnit(elapsed)
  const age = formatAge(locale, unit, 'narrow', value)
  const hot = isAgeHot(elapsed)
  return (
    <time
      dateTime={new Date(since).toISOString()}
      title={label(formatAge(locale, unit, 'long', value))}
      className={cn(
        'shrink-0 font-mono text-[11px] leading-none whitespace-nowrap normal-case',
        hot ? 'font-bold text-note' : 'opacity-75',
        className,
      )}
    >
      {age}
    </time>
  )
}
