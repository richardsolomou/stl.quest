import type { BeforeSendFn, CaptureResult } from 'posthog-js'
import { isExpectedStorageProblem } from '../core/storageProblems'

// The storage settings pane and its folder picker both catch the server's validation rejections and
// show them inline, yet posthog-js still records them as uncaught exceptions ($exception_handled is
// false): the rejection reaches the browser's global handler before the application's own catch
// runs. So an operator browsing to an unmounted folder, or testing a destination the container
// cannot write to, files an error-tracking issue for an answer the UI already gave them — and the
// destination messages carry the configured storage path with them. Dropping them at the client
// keeps the server throwing the same 400s and the UI showing the same text.
export function dropExpectedStorageProblems(event: CaptureResult | null) {
  if (!event || event.event !== '$exception') return event
  const exceptions: unknown = event.properties?.['$exception_list']
  if (!Array.isArray(exceptions) || exceptions.length === 0) return event
  const expected = exceptions.every((exception: { value?: unknown }) => {
    const value = exception?.value
    return typeof value === 'string' && isExpectedStorageProblem(value)
  })
  return expected ? null : event
}

const SERVER_FUNCTION_CHUNK = /\/assets\/fns-[^/]+\.js$/

function isServerFunctionDeserialization(event: CaptureResult): boolean {
  if (event.event !== '$exception') return false
  const exceptions = event.properties.$exception_list
  if (!Array.isArray(exceptions)) return false

  return exceptions.some((exception) => {
    if (!exception || typeof exception !== 'object') return false
    const stacktrace = (exception as { stacktrace?: unknown }).stacktrace
    if (!stacktrace || typeof stacktrace !== 'object') return false
    const frames = (stacktrace as { frames?: unknown }).frames
    if (!Array.isArray(frames)) return false

    return frames.some((frame) => {
      if (!frame || typeof frame !== 'object') return false
      const { function: functionName, source } = frame as { function?: unknown; source?: unknown }
      return functionName === 'Object.deserialize' && typeof source === 'string' && SERVER_FUNCTION_CHUNK.test(source)
    })
  })
}

export const dropDuplicateServerFunctionException: BeforeSendFn = (event) =>
  event && isServerFunctionDeserialization(event) ? null : event
