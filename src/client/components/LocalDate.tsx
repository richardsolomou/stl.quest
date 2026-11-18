import { formatDate } from '../../core/format'
import type { Locale } from '../../core/i18n'

export function LocalDate({ value, locale, className }: { value: number; locale: Locale; className?: string }) {
  return (
    <time dateTime={new Date(value).toISOString()} className={className}>
      {formatDate(value, locale)}
    </time>
  )
}
