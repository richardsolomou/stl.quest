import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { gunzipSync } from 'node:zlib'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { withServerFunction } from './serverFunction'
import { hostVariable, projectTokenVariable, serviceName } from '../contracts/posthog'
import { createTelemetry, requestContext, type TelemetryOptions } from './telemetry'

type Received = { path: string; authorization: string | undefined; body: any }

const received: Received[] = []
let host: string
let server: Server
let stallLogs = false

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      if (stallLogs && request.url === '/i/v1/logs') return
      const raw = Buffer.concat(chunks)
      const text = (request.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw).toString()
      received.push({
        path: request.url!.split('?')[0]!,
        authorization: request.headers.authorization,
        body: text ? JSON.parse(text) : undefined,
      })
      response.writeHead(200, { 'content-type': 'application/json' }).end('{}')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => {
  server.closeAllConnections()
  return new Promise((resolve) => server.close(resolve))
})
beforeEach(() => {
  received.length = 0
  stallLogs = false
})

const enabledWith = (options: TelemetryOptions) =>
  createTelemetry({ [projectTokenVariable]: 'phc_test', [hostVariable]: host, NODE_ENV: 'production' }, options)
const enabled = () => enabledWith({})
const sent = (path: string) => received.filter((request) => request.path === path)
const logRecords = () => sent('/i/v1/logs').flatMap(({ body }) => body.resourceLogs[0].scopeLogs[0].logRecords)
const attributes = (record: { attributes: { key: string; value: Record<string, unknown> }[] }) =>
  Object.fromEntries(record.attributes.map(({ key, value }) => [key, Object.values(value)[0]]))

describe('createTelemetry without a project token', () => {
  it('sends nothing', async () => {
    const telemetry = createTelemetry({})
    telemetry.posthog.capture({ distinctId: 'person-1', event: 'count_incremented' })
    telemetry.posthog.metrics.count('counts', 1)
    telemetry.log('info', 'count incremented')
    await telemetry.shutdown()
    expect(received).toEqual([])
  })

  it('still runs traced work', async () => {
    const telemetry = createTelemetry({})
    expect(await telemetry.posthog.withSpan('work', async () => 'done')).toBe('done')
  })
})

describe('createTelemetry with a project token', () => {
  it('sends events', async () => {
    const telemetry = enabled()
    telemetry.posthog.capture({ distinctId: 'person-1', event: 'count_incremented' })
    await telemetry.shutdown()
    expect(sent('/batch/').flatMap(({ body }) => body.batch.map(({ event }: { event: string }) => event))).toEqual(['count_incremented'])
  })

  it('authenticates logs with the project token', async () => {
    const telemetry = enabled()
    telemetry.log('info', 'count incremented')
    await telemetry.shutdown()
    expect(sent('/i/v1/logs').map(({ authorization }) => authorization)).toEqual(['Bearer phc_test'])
  })

  it('names the server service on logs', async () => {
    const telemetry = enabled()
    telemetry.log('info', 'count incremented')
    await telemetry.shutdown()
    expect(attributes(sent('/i/v1/logs')[0]!.body.resourceLogs[0].resource)).toEqual({
      'service.name': `${serviceName}-server`,
      'deployment.environment': 'production',
    })
  })

  it('sends the log severity, body, and attributes', async () => {
    const telemetry = enabled()
    telemetry.log('warn', 'count incremented', { count: 2 })
    await telemetry.shutdown()
    const [record] = logRecords()
    expect([record.severityText, record.severityNumber, record.body.stringValue, attributes(record)]).toEqual([
      'warn',
      13,
      'count incremented',
      { count: 2 },
    ])
  })

  it('bounds a log body', async () => {
    const telemetry = enabled()
    telemetry.log('info', 'b'.repeat(3_000))
    await telemetry.shutdown()
    expect(logRecords()[0].body.stringValue).toHaveLength(2_048)
  })

  it('bounds a log attribute value', async () => {
    const telemetry = enabled()
    telemetry.log('info', 'large', { large: 'a'.repeat(3_000) })
    await telemetry.shutdown()
    expect(attributes(logRecords()[0]).large).toHaveLength(2_048)
  })

  it('bounds the number of log attributes', async () => {
    const telemetry = enabled()
    telemetry.log('info', 'many', Object.fromEntries(Array.from({ length: 70 }, (_, index) => [`extra${index}`, index])))
    await telemetry.shutdown()
    expect(logRecords()[0].attributes).toHaveLength(64)
  })

  it('records an unserializable attribute without failing', async () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const telemetry = enabled()
    telemetry.log('info', 'circular', { circular })
    await telemetry.shutdown()
    expect(attributes(logRecords()[0]).circular).toBe('[Unserializable value]')
  })

  it('links a log to its server function, person, and session', async () => {
    const telemetry = enabled()
    withServerFunction({ name: 'incrementCount', filename: 'src/server/functions.ts' }, () =>
      telemetry.posthog.withContext({ distinctId: 'person-1', sessionId: 'session-1' }, () => telemetry.log('info', 'count incremented')),
    )
    await telemetry.shutdown()
    expect(attributes(logRecords()[0])).toEqual({
      server_function: 'incrementCount',
      posthogDistinctId: 'person-1',
      sessionId: 'session-1',
    })
  })

  it('names the server service on spans', async () => {
    const telemetry = enabled()
    await telemetry.posthog.withSpan('work', async () => 'done')
    await telemetry.shutdown()
    expect(attributes(sent('/i/v1/traces')[0]!.body.resourceSpans[0].resource)['service.name']).toBe(`${serviceName}-server`)
  })

  it('adds the service version and resource attributes to logs', async () => {
    const telemetry = enabledWith({ serviceVersion: '1.2.3', resourceAttributes: { 'deployment.host': 'app.example' } })
    telemetry.log('info', 'count incremented')
    await telemetry.shutdown()
    expect(attributes(sent('/i/v1/logs')[0]!.body.resourceLogs[0].resource)).toEqual({
      'deployment.host': 'app.example',
      'service.name': `${serviceName}-server`,
      'deployment.environment': 'production',
      'service.version': '1.2.3',
    })
  })

  it('adds the service version and resource attributes to spans', async () => {
    const telemetry = enabledWith({ serviceVersion: '1.2.3', resourceAttributes: { 'deployment.host': 'app.example' } })
    await telemetry.posthog.withSpan('work', async () => 'done')
    await telemetry.shutdown()
    expect(attributes(sent('/i/v1/traces')[0]!.body.resourceSpans[0].resource)).toMatchObject({
      'deployment.host': 'app.example',
      'service.version': '1.2.3',
    })
  })

  it('drops the events beforeSend drops', async () => {
    const telemetry = enabledWith({ beforeSend: (event) => (event?.event === 'internal' ? null : event) })
    telemetry.posthog.capture({ distinctId: 'person-1', event: 'internal' })
    telemetry.posthog.capture({ distinctId: 'person-1', event: 'count_incremented' })
    await telemetry.shutdown()
    expect(sent('/batch/').flatMap(({ body }) => body.batch.map(({ event }: { event: string }) => event))).toEqual(['count_incremented'])
  })

  it('sends queued events once when shut down twice', async () => {
    const telemetry = enabled()
    telemetry.posthog.capture({ distinctId: 'person-1', event: 'count_incremented' })
    await telemetry.shutdown()
    await telemetry.shutdown()
    expect(sent('/batch/').flatMap(({ body }) => body.batch)).toHaveLength(1)
  })

  it('ignores captures after shutdown', async () => {
    const telemetry = enabled()
    await telemetry.shutdown()
    telemetry.posthog.capture({ distinctId: 'person-1', event: 'late' })
    telemetry.log('info', 'late')
    await telemetry.flush()
    expect(received).toEqual([])
  })

  it('gives up on a stalled log exporter at the shutdown deadline', async () => {
    stallLogs = true
    const telemetry = enabled()
    telemetry.log('info', 'count incremented')
    await expect(telemetry.shutdown(100)).rejects.toThrow('PostHog log shutdown timed out after 100ms')
  })

  it('gives up within two seconds by default, inside the container’s shutdown budget', async () => {
    stallLogs = true
    const telemetry = enabled()
    telemetry.log('info', 'count incremented')
    await expect(telemetry.shutdown()).rejects.toThrow('PostHog log shutdown timed out after 2000ms')
  })
})

describe('requestContext', () => {
  const anonymousId = '019a8f2e-1c3b-7d5e-8f60-1a2b3c4d5e6f'
  const request = (headers: Record<string, string>) => new Request('https://app.example/_serverFn/abc', { headers })

  it('links the browser session', () => {
    expect(requestContext(request({ 'x-posthog-session-id': 'session-1' }))).toEqual({ sessionId: 'session-1' })
  })

  it('accepts the claimed person when authentication agrees', () => {
    expect(requestContext(request({ 'x-posthog-distinct-id': 'person-1' }), 'person-1')).toEqual({ distinctId: 'person-1' })
  })

  it('ignores a claimed person authentication does not agree with', () => {
    expect(requestContext(request({ 'x-posthog-distinct-id': 'attacker' }), 'person-1')).toEqual({})
  })

  it('ignores a claimed person without authentication', () => {
    expect(requestContext(request({ 'x-posthog-distinct-id': 'person-1' }))).toEqual({})
  })

  it('links a signed-out caller to their anonymous browser person', () => {
    expect(requestContext(request({ 'x-posthog-distinct-id': anonymousId }))).toEqual({ distinctId: anonymousId })
  })

  it('ignores an anonymous person claimed by a signed-in caller', () => {
    expect(requestContext(request({ 'x-posthog-distinct-id': anonymousId }), 'person-1')).toEqual({})
  })

  it('ignores an anonymous-looking id that is not a version 7 UUID', () => {
    expect(requestContext(request({ 'x-posthog-distinct-id': '019a8f2e-1c3b-4d5e-8f60-1a2b3c4d5e6f' }))).toEqual({})
  })

  it.each(['s'.repeat(129), 'session 1', 'session<script>'])('ignores the session id %s', (sessionId) => {
    expect(requestContext(request({ 'x-posthog-session-id': sessionId }))).toEqual({})
  })
})
