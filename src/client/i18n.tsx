import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { DEFAULT_LOCALE, messagesFor, type Locale, type Messages } from '../core/i18n'

export type I18n = { locale: Locale; t: Messages }

const I18nContext = createContext<I18n>({ locale: DEFAULT_LOCALE, t: messagesFor(DEFAULT_LOCALE) })

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(() => ({ locale, t: messagesFor(locale) }), [locale])
  return <I18nContext value={value}>{children}</I18nContext>
}

export function useI18n() {
  return useContext(I18nContext)
}
