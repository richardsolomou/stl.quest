import { MutationCache } from '@tanstack/react-query'
import { createQueryClient as configuredQueryClient } from 'ras-stack/query'
import { toast } from 'sonner'
import { errorMessage } from '../core/error'
import { messagesFor, resolveLocale, type Messages } from '../core/i18n'

export function createQueryClient() {
  return configuredQueryClient({
    defaultOptions: { queries: { staleTime: 0 } },
    mutationCache: new MutationCache({
      onError: (error) => toast.error(mutationErrorMessage(error, documentMessages())),
    }),
  })
}

export function mutationErrorMessage(error: unknown, t: Messages) {
  const message = errorMessage(error, t.shell.query.mutationFailed)
  return message === messagesFor('en').shell.query.staleServerFunction ? t.shell.query.staleServerFunction : message
}

// The client is built before the router knows the request's language; mutations only fail in the browser, where the root sets `<html lang>`.
function documentMessages() {
  return messagesFor(resolveLocale(typeof document === 'undefined' ? undefined : document.documentElement.lang, undefined))
}
