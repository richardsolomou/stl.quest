import * as en from './en'
import * as fr from './fr'
import * as de from './de'
import { DEFAULT_LOCALE, type Locale } from './locales'

export * from './locales'

/** English is the source catalog; every other language must provide exactly the same keys and message signatures. */
export type Messages = typeof en

const catalogs: Record<Locale, Messages> = { en, fr, de }

export function messagesFor(locale: Locale = DEFAULT_LOCALE): Messages {
  return catalogs[locale]
}

/** Workflow ids are open strings, so an unknown one falls back to the id rather than failing. */
export function statusText(messages: Messages, field: 'label' | 'empty' | 'rankLabel', id: string): string {
  return (messages.status[field] as Record<string, string | undefined>)[id] ?? id
}
