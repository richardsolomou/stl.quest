import { describe, expect, it } from 'vitest'
import { staleClientMessage, unknownServerFunctionResponse } from './unknownServerFunction'

describe('unknown server function response', () => {
  it('tells a tab calling a removed server function to refresh', async () => {
    const response = unknownServerFunctionResponse(new Error('Server function info not found for 7ff295b7'))

    expect(await response?.text()).toBe(staleClientMessage)
  })

  it('answers with a failed plain-text response the framework client throws as an error', () => {
    const response = unknownServerFunctionResponse(new Error('Server function info not found for 7ff295b7'))

    expect({ status: response?.status, contentType: response?.headers.get('Content-Type') }).toEqual({
      status: 404,
      contentType: 'text/plain; charset=utf-8',
    })
  })

  it('leaves other server function failures to the framework', () => {
    expect(unknownServerFunctionResponse(new Error('database unavailable'))).toBeUndefined()
  })
})
