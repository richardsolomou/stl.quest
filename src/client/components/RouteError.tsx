import type { ErrorComponentProps } from '@tanstack/react-router'
import { useEffect } from 'react'
import { reportRouteError } from '../../server/fns'
import { useI18n } from '../i18n'

export function RouteError({ error, reset }: ErrorComponentProps) {
  const { t } = useI18n()
  useEffect(() => {
    void reportRouteError({ data: serializeRouteError(error) }).catch(() => undefined)
  }, [error])

  return (
    <main className="mx-auto mt-[15vh] max-w-lg p-6 text-center">
      <h1>{t.common.somethingWentWrong}</h1>
      <p className="text-muted-foreground">{t.shell.routeError.body}</p>
      <button
        type="button"
        className="mt-4 rounded-md border px-4 py-2 font-medium"
        onClick={() => {
          reset()
          window.location.reload()
        }}
      >
        {t.shell.routeError.refresh}
      </button>
    </main>
  )
}

export function serializeRouteError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name.slice(0, 100),
      message: error.message.slice(0, 2_000),
      stack: error.stack?.slice(0, 20_000),
    }
  }
  return { name: 'Error', message: String(error).slice(0, 2_000) }
}
