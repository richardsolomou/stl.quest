import { AsyncLocalStorage } from 'node:async_hooks'
import { DEFAULT_LOCALE, messagesFor, negotiateLocale, type Locale } from '../core/i18n'

let instance: AsyncLocalStorage<{ locale: Locale }> | undefined

/** Created on first use: client bundles import server-function modules, and a top-level constructor would survive tree-shaking there. */
const storage = () => (instance ??= new AsyncLocalStorage())

/** Starts from the browser's languages; resolving the signed-in user replaces it with their own choice. */
export function withRequestLocale<T>(request: Request | undefined, work: () => T): T {
  return storage().run({ locale: negotiateLocale(request?.headers.get('accept-language')) }, work)
}

export function setRequestLocale(locale: Locale | undefined) {
  const store = storage().getStore()
  if (store && locale) store.locale = locale
}

export function requestLocale(): Locale {
  return storage().getStore()?.locale ?? DEFAULT_LOCALE
}

/** Messages for text the server writes into a response, such as a thrown `Response` the client shows as an error. */
export function serverMessages() {
  return messagesFor(requestLocale())
}
