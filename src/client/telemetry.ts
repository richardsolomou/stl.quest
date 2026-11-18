import type { BeforeSendFn, CaptureResult } from 'posthog-js'
import { isExpectedStorageProblem } from '../core/storageProblems'
import type { PublicPrintRequest } from '../core/types'

function exceptionList(event: CaptureResult | null) {
  if (event?.event !== '$exception') return undefined
  const exceptions: unknown = event.properties?.['$exception_list']
  return Array.isArray(exceptions) && exceptions.length > 0 ? exceptions : undefined
}

// posthog-js records the storage pane's server validation rejections as uncaught even though the pane shows them inline,
// and their messages carry the configured storage path.
export function dropExpectedStorageProblems(event: CaptureResult | null) {
  const expected = exceptionList(event)?.every((exception: { value?: unknown }) => {
    const value = exception?.value
    return typeof value === 'string' && isExpectedStorageProblem(value)
  })
  return expected ? null : event
}

const SERVER_FUNCTION_CHUNK = /\/assets\/fns-[^/]+\.js$/

function isServerFunctionDeserialization(event: CaptureResult): boolean {
  return (
    exceptionList(event)?.some((exception: { stacktrace?: { frames?: unknown } } | null) => {
      const frames = exception?.stacktrace?.frames
      return (
        Array.isArray(frames) &&
        frames.some((frame: { function?: unknown; source?: unknown } | null) => {
          return frame?.function === 'Object.deserialize' && typeof frame.source === 'string' && SERVER_FUNCTION_CHUNK.test(frame.source)
        })
      )
    }) ?? false
  )
}

export const dropDuplicateServerFunctionException: BeforeSendFn = (event) =>
  event && isServerFunctionDeserialization(event) ? null : event

// The browser reports an error from a script of another origin as a bare "Script error." with no
// file, line, or stack. The CSP only lets the page run same-origin scripts, whose errors keep their
// detail, so this message comes from a script the browser or an extension injects (Firefox for iOS
// raises one on most taps). The report holds nothing to diagnose and nothing STL Quest can fix.
const OPAQUE_SCRIPT_ERROR = /^Script error\.?$/

export const dropOpaqueScriptError = (event: Parameters<BeforeSendFn>[0] | null) => {
  const opaque = exceptionList(event)?.every((exception: { value?: unknown; stacktrace?: { frames?: unknown } }) => {
    const frames = exception?.stacktrace?.frames
    return (
      typeof exception?.value === 'string' && OPAQUE_SCRIPT_ERROR.test(exception.value) && !(Array.isArray(frames) && frames.length > 0)
    )
  })
  return opaque ? null : event
}

export function requestViewedProperties(request: Pick<PublicPrintRequest, 'printType' | 'mine' | 'counts'> | undefined, isAdmin: boolean) {
  const activeStatuses = request
    ? Object.entries(request.counts)
        .filter(([, count]) => count > 0)
        .map(([status]) => status)
    : []
  return {
    print_type: request?.printType,
    viewer_relation: request?.mine ? 'owner' : isAdmin ? 'operator' : 'other_requester',
    active_statuses: activeStatuses,
    has_started: activeStatuses.some((status) => status !== 'todo'),
  }
}
