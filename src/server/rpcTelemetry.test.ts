import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { observeServerFunction } from './rpcTelemetry'
import { withServerFunction } from './serverFunction'
import { createTelemetry, type Telemetry } from './telemetry'

let telemetry: Telemetry
let span: { setAttribute: ReturnType<typeof vi.fn>; setAttributes: ReturnType<typeof vi.fn> }
let spanResult: Promise<unknown> | undefined
let spies: ReturnType<typeof spyOn>

function spyOn({ posthog }: Telemetry) {
  return {
    withSpan: vi
      .spyOn(posthog, 'withSpan')
      .mockImplementation(
        ((_name: string, _options: unknown, work: (span: unknown) => unknown) => (spanResult = work(span) as Promise<unknown>)) as never,
      ),
    count: vi.spyOn(posthog.metrics, 'count'),
    histogram: vi.spyOn(posthog.metrics, 'histogram'),
    captureException: vi.spyOn(posthog, 'captureException'),
    error: vi.spyOn(console, 'error').mockImplementation(() => undefined),
  }
}

beforeEach(() => {
  telemetry = createTelemetry({})
  span = { setAttribute: vi.fn(), setAttributes: vi.fn() }
  span.setAttribute.mockReturnValue(span)
  span.setAttributes.mockReturnValue(span)
  spies = spyOn(telemetry)
})
afterEach(() => vi.restoreAllMocks())

const request = (headers: Record<string, string> = {}) =>
  new Request('https://app.example/_serverFn/abc?token=secret', { method: 'POST', headers })
const refusal = () => new Error('Sign in first', { cause: new Response('Sign in first', { status: 401 }) })

describe('observeServerFunction', () => {
  it('returns the result of its work', async () => {
    await expect(observeServerFunction(telemetry, request(), async () => 'done')).resolves.toBe('done')
  })

  it('runs work without a request outside any span', async () => {
    await expect(observeServerFunction(telemetry, undefined, async () => 'done')).resolves.toBe('done')
    expect(spies.withSpan).not.toHaveBeenCalled()
  })

  it('continues the browser trace', async () => {
    const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
    await observeServerFunction(telemetry, request({ traceparent }), async () => 'done')
    expect(spies.withSpan).toHaveBeenCalledWith('server_function', { kind: 'server', parent: traceparent }, expect.any(Function))
  })

  it('counts a success by method and function', async () => {
    await withServerFunction({ name: 'readCount', filename: 'src/server/functions.ts' }, () =>
      observeServerFunction(telemetry, request(), async () => 'done'),
    )
    expect(spies.count).toHaveBeenCalledWith('server_function.requests', 1, {
      attributes: { method: 'POST', function: 'readCount', outcome: 'success' },
    })
  })

  it('records the duration in milliseconds', async () => {
    await observeServerFunction(telemetry, request(), async () => 'done')
    expect(spies.histogram).toHaveBeenCalledWith('server_function.duration', expect.any(Number), {
      unit: 'ms',
      attributes: { method: 'POST' },
    })
  })

  it('keeps the URL out of metrics', async () => {
    await observeServerFunction(telemetry, request(), async () => 'done')
    expect(JSON.stringify(spies.count.mock.calls)).not.toContain('secret')
  })

  it('names the server function on its span', async () => {
    await withServerFunction({ name: 'readCount', filename: 'src/server/functions.ts' }, () =>
      observeServerFunction(telemetry, request(), async () => 'done'),
    )
    expect(span.setAttributes).toHaveBeenCalledWith({ 'code.function.name': 'readCount', 'code.file.path': 'src/server/functions.ts' })
  })

  it('rethrows a failure', async () => {
    const failure = new Error('broken')
    await expect(observeServerFunction(telemetry, request(), () => Promise.reject(failure))).rejects.toBe(failure)
  })

  it('counts a failure as an error', async () => {
    await observeServerFunction(telemetry, request(), () => Promise.reject(new Error('broken'))).catch(() => undefined)
    expect(span.setAttribute).toHaveBeenLastCalledWith('server.function.outcome', 'error')
  })

  it('counts a 5xx response as an error', async () => {
    const failure = new Error('unavailable', { cause: new Response('unavailable', { status: 503 }) })
    await observeServerFunction(telemetry, request(), () => Promise.reject(failure)).catch(() => undefined)
    expect(spies.count).toHaveBeenCalledWith('server_function.requests', 1, {
      attributes: { method: 'POST', outcome: 'error' },
    })
  })

  it('rethrows a 4xx response', async () => {
    const error = refusal()
    await expect(observeServerFunction(telemetry, request(), () => Promise.reject(error))).rejects.toBe(error)
  })

  it('counts a 4xx response as refused', async () => {
    await observeServerFunction(telemetry, request(), () => Promise.reject(refusal())).catch(() => undefined)
    expect(spies.count).toHaveBeenCalledWith('server_function.requests', 1, {
      attributes: { method: 'POST', outcome: 'refused' },
    })
  })

  it('records the status of a 4xx response on its span', async () => {
    await observeServerFunction(telemetry, request(), () => Promise.reject(refusal())).catch(() => undefined)
    expect(span.setAttribute).toHaveBeenCalledWith('http.response.status_code', 401)
  })

  it('leaves the span unfailed by a 4xx response', async () => {
    await observeServerFunction(telemetry, request(), () => Promise.reject(refusal())).catch(() => undefined)
    await expect(spanResult).resolves.toBeDefined()
  })

  it('links work to the browser session', async () => {
    const context = await observeServerFunction(telemetry, request({ 'x-posthog-session-id': 'session-1' }), async () =>
      telemetry.posthog.getContext(),
    )
    expect(context?.sessionId).toBe('session-1')
  })

  it('links work to the person only when authentication agrees', async () => {
    const context = await observeServerFunction(
      telemetry,
      request({ 'x-posthog-distinct-id': 'person-1' }),
      async () => telemetry.posthog.getContext(),
      'person-1',
    )
    expect(context?.distinctId).toBe('person-1')
  })
})
