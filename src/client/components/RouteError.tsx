import type { ErrorComponentProps } from '@tanstack/react-router'

export function RouteError({ reset }: ErrorComponentProps) {
  return (
    <main className="mx-auto mt-[15vh] max-w-lg p-6 text-center">
      <h1>Something went wrong</h1>
      <p className="text-muted-foreground">
        The server could not load this page. Refresh to try again, then check the server logs if it continues.
      </p>
      <button
        type="button"
        className="mt-4 rounded-md border px-4 py-2 font-medium"
        onClick={() => {
          reset()
          window.location.reload()
        }}
      >
        Refresh
      </button>
    </main>
  )
}
