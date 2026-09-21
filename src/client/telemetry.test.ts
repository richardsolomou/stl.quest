import { describe, expect, it } from 'vitest'
import type { CaptureResult } from 'posthog-js'
import { dropExpectedStorageProblems } from './telemetry'

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
