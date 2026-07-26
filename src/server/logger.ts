import pino from 'pino'
import { currentRequestLogContext } from './requestContext'

type TelemetryExporters = {
  exception: (error: unknown, properties?: Record<string, unknown>) => void
  log: (record: Record<string, unknown>) => void
}

let telemetryExporters: TelemetryExporters | undefined

export function setTelemetryExporters(exporters: TelemetryExporters | undefined) {
  telemetryExporters = exporters
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  base: { service: 'stlquest' },
  redact: {
    paths: ['password', 'token', 'authorization', 'cookie', '*.password', '*.token', '*.authorization', '*.cookie'],
    censor: '[Redacted]',
  },
  hooks: {
    logMethod(args, method, level) {
      if (level >= 50 && args[0] && typeof args[0] === 'object' && 'err' in args[0]) {
        const { err, ...properties } = args[0]
        telemetryExporters?.exception(err, redactRecord(properties))
      }
      return method.apply(this, args)
    },
    streamWrite(serialized) {
      try {
        const record = redactRecord(JSON.parse(serialized) as Record<string, unknown>)
        telemetryExporters?.log(record)
        return `${JSON.stringify(record)}\n`
      } catch {}
      return serialized
    },
  },
  mixin: () => currentRequestLogContext() ?? {},
})

const sensitiveKey = /(?:password|token|authorization|cookie|secret|apiKey|dataDirectory|relativePath|storageRoot|fileName)$/i

function redactRecord(record: Record<string, unknown>) {
  return redactValue(record, undefined, new WeakSet()) as Record<string, unknown>
}

function redactValue(value: unknown, key: string | undefined, seen: WeakSet<object>): unknown {
  if (key && sensitiveKey.test(key.replaceAll(/[-_.]/g, ''))) return '[Redacted]'
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return '[Circular]'
  seen.add(value)
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, undefined, seen))
  return Object.fromEntries(Object.entries(value).map(([entryKey, entry]) => [entryKey, redactValue(entry, entryKey, seen)]))
}
