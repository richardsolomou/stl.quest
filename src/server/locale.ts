import { AsyncLocalStorage } from 'node:async_hooks'
import { createServerOnlyFn } from '@tanstack/react-start'
import { DEFAULT_LOCALE, messagesFor, negotiateLocale, type Locale } from '../core/i18n'

let instance: AsyncLocalStorage<{ locale: Locale }> | undefined

/** Strip the Node dependency from client imports of server-function modules, including unbundled dev modules. */
const storage = createServerOnlyFn(() => (instance ??= new AsyncLocalStorage<{ locale: Locale }>()))

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
