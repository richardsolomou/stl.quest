import { describe, expect, it } from 'vitest'
import type { CaptureResult, Properties } from 'posthog-js'
import { dropDuplicateServerFunctionException, dropExpectedStorageProblems, requestViewedProperties } from './telemetry'

const exceptionEvent = (...values: string[]) =>
  ({
    uuid: 'test',
    event: '$exception',
    properties: { $exception_list: values.map((value) => ({ type: 'Error', value, mechanism: { handled: false } })) },
  }) as unknown as CaptureResult

describe('dropExpectedStorageProblems', () => {
  it('drops the folder picker rejection the operator already saw in the dialog', () => {
    expect(dropExpectedStorageProblems(exceptionEvent('folder is not readable'))).toBeNull()
  })

  it('drops a destination rejection along with the storage path in its detail', () => {
    expect(
      dropExpectedStorageProblems(
        exceptionEvent("storage is not reachable or not writable: ENOENT: no such file or directory, mkdir '/prints'"),
      ),
    ).toBeNull()
  })

  it('keeps a genuine browser fault', () => {
    const event = exceptionEvent('Failed to fetch')
    expect(dropExpectedStorageProblems(event)).toBe(event)
  })

  it('keeps a group where only part of the chain is an expected problem', () => {
    const event = exceptionEvent('folder is not readable', 'Cannot read properties of undefined')
    expect(dropExpectedStorageProblems(event)).toBe(event)
  })

  it('keeps an exception with no readable list', () => {
    const event = { uuid: 'test', event: '$exception', properties: {} } as unknown as CaptureResult
    expect(dropExpectedStorageProblems(event)).toBe(event)
  })

  it('leaves every other event alone', () => {
    const event = { uuid: 'test', event: '$pageview', properties: {} } as unknown as CaptureResult
    expect(dropExpectedStorageProblems(event)).toBe(event)
    expect(dropExpectedStorageProblems(null)).toBeNull()
  })
})

function capturedExceptionEvent(properties: Properties): CaptureResult {
  return { uuid: '019ff1ca-7fbf-794c-b8b8-cb1ff90fb0df', event: '$exception', properties }
}

describe('dropDuplicateServerFunctionException', () => {
  it('drops a server-function rejection reconstructed in the browser', () => {
    const event = capturedExceptionEvent({
      $exception_list: [
        {
          type: 'Error',
          value: 'server failed',
          stacktrace: { frames: [{ function: 'Object.deserialize', source: '/assets/fns-C0TfxVDL.js' }] },
        },
      ],
    })

    expect(dropDuplicateServerFunctionException(event)).toBeNull()
  })

  it('keeps an unrelated browser exception', () => {
    const event = capturedExceptionEvent({
      $exception_list: [
        {
          type: 'Error',
          value: 'client failed',
          stacktrace: { frames: [{ function: 'Object.deserialize', source: '/assets/app.js' }] },
        },
      ],
    })

    expect(dropDuplicateServerFunctionException(event)).toBe(event)
  })

  it('keeps non-exception events', () => {
    const event: CaptureResult = { uuid: '019ff1ca-7fbf-794c-b8b8-cb1ff90fb0df', event: '$pageview', properties: {} }

    expect(dropDuplicateServerFunctionException(event)).toBe(event)
  })
})

describe('requestViewedProperties', () => {
  it('describes an owner viewing their own queued print', () => {
    expect(requestViewedProperties({ printType: 'resin', mine: true, counts: { todo: 2, done: 0 } }, false)).toEqual({
      print_type: 'resin',
      viewer_relation: 'owner',
      active_statuses: ['todo'],
      has_started: false,
    })
  })

  it('marks a print as started once any copy has left the queue', () => {
    expect(requestViewedProperties({ mine: true, counts: { todo: 1, up_next: 1 } }, false).has_started).toBe(true)
  })

  it("names an admin viewing someone else's print the operator", () => {
    expect(requestViewedProperties({ mine: false, counts: { todo: 1 } }, true).viewer_relation).toBe('operator')
  })

  it("names a member viewing someone else's print another requester", () => {
    expect(requestViewedProperties({ mine: false, counts: { todo: 1 } }, false).viewer_relation).toBe('other_requester')
  })

  it('reports no stages when the print is not loaded', () => {
    expect(requestViewedProperties(undefined, false).active_statuses).toEqual([])
  })
})
