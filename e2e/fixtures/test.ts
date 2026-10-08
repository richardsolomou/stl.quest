import { test as base, type Page, type Request } from '@playwright/test'

export { expect } from '@playwright/test'

// Attaches what the browser saw to failed tests so CI-only failures are diagnosable from the report alone.
export const test = base.extend<{ browserDiagnostics: void }>({
  browserDiagnostics: [
    async ({ context }, use, testInfo) => {
      const events: string[] = []
      const pending = new Set<Request>()
      const record = (line: string) => events.push(`${new Date().toISOString()} ${line}`)
      context.on('console', (message) => {
        if (message.type() === 'error' || message.type() === 'warning') record(`console.${message.type()}: ${message.text()}`)
      })
      context.on('weberror', (error) => record(`page error: ${error.error().stack ?? error.error().message}`))
      context.on('request', (request) => pending.add(request))
      context.on('requestfinished', (request) => pending.delete(request))
      context.on('requestfailed', (request) => {
        pending.delete(request)
        record(`request failed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`)
      })
      context.on('response', (response) => {
        if (response.status() >= 400) record(`HTTP ${response.status()}: ${response.request().method()} ${response.url()}`)
      })

      await use()

      if (testInfo.status === testInfo.expectedStatus) return
      // The terminal reporter prints only the first 300 characters, so the most telling lines come first.
      const summary: string[] = []
      for (const page of context.pages()) summary.push(`page state: ${page.url()} ${await pageState(page)}`)
      for (const request of pending) summary.push(`request unfinished: ${request.method()} ${request.url()}`)
      await testInfo.attach('browser-diagnostics', {
        body: [...summary, ...events].join('\n') || 'No pages, browser errors, failed requests, or unfinished requests were recorded.',
        contentType: 'text/plain',
      })
    },
    { auto: true },
  ],
})

// TanStack Start deletes window.$_TSR once the client has hydrated and the SSR stream has ended.
async function pageState(page: Page) {
  const state = page.evaluate(() => {
    const bootstrap = (window as { $_TSR?: { initialized?: boolean; hydrated?: boolean; streamEnded?: boolean } }).$_TSR
    return JSON.stringify({
      readyState: document.readyState,
      tanstackBootstrap: bootstrap
        ? {
            initialized: bootstrap.initialized ?? false,
            hydrated: bootstrap.hydrated ?? false,
            streamEnded: bootstrap.streamEnded ?? false,
          }
        : 'released',
    })
  })
  const timeout = new Promise<string>((resolve) => setTimeout(() => resolve('unavailable (evaluation timed out)'), 5_000))
  return Promise.race([state.catch((error: Error) => `unavailable (${error.message})`), timeout])
}
