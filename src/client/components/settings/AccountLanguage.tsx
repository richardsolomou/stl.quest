import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { LOCALE_NAMES, LOCALES, isLocale, negotiateLocale, type Locale } from '../../../core/i18n'
import { updateLocale } from '../../../server/fns'
import { useI18n } from '../../i18n'
import { SettingNotice, noticeDetail } from '../SettingNotice'
import { SettingsSection } from './SettingsLayout'

const BROWSER = 'browser'

export function AccountLanguage({ preference }: { preference?: Locale }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const callUpdate = useServerFn(updateLocale)
  const mutation = useMutation({
    mutationFn: callUpdate,
    // The session carries the resolved language, so refreshing it re-renders everything in the new one.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session'] }),
  })
  const browserLocale = typeof navigator === 'undefined' ? undefined : negotiateLocale(navigator.languages.join(','))
  const browserLabel = t.language.browser(browserLocale ? LOCALE_NAMES[browserLocale] : '…')
  const items = [{ value: BROWSER, label: browserLabel }, ...LOCALES.map((locale) => ({ value: locale, label: LOCALE_NAMES[locale] }))]
  const value = preference ?? BROWSER
  return (
    <SettingsSection title={t.language.title}>
      <Field orientation="horizontal" className="max-sm:flex-col">
        <FieldContent>
          <FieldLabel htmlFor="interface-language">{t.language.label}</FieldLabel>
          <FieldDescription>{t.language.description}</FieldDescription>
        </FieldContent>
        <Select
          items={items}
          value={value}
          disabled={mutation.isPending}
          onValueChange={(next) => {
            if (next === value) return
            mutation.mutate({ data: { locale: isLocale(next) ? next : undefined } })
          }}
        >
          <SelectTrigger className="w-auto max-w-56 max-sm:w-full max-sm:max-w-none" id="interface-language" aria-label={t.language.label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end" alignItemWithTrigger={false}>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {mutation.error && (
        <SettingNotice
          notice={{
            tone: 'error',
            title: t.language.saveFailedTitle,
            hint: t.language.saveFailedHint,
            detail: noticeDetail(mutation.error),
          }}
        />
      )}
    </SettingsSection>
  )
}
