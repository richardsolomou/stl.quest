import { describe, expect, it } from 'vitest'
import type { PublicPrintRequest } from '../core/types'
import { reconcileBoardOverrides, type BoardOverride } from './boardOverrides'

const request = { id: 'request', counts: { todo: 1 }, orders: { todo: 2 } } as unknown as PublicPrintRequest
const override: BoardOverride = { counts: { todo: 1 }, orders: { todo: 2 } }

describe('reconcileBoardOverrides', () => {
  it('removes an override reflected by live data', () => {
    expect(reconcileBoardOverrides({ request: override }, [request])).toEqual({})
  })

  it('removes an override whose request disappeared', () => {
    expect(reconcileBoardOverrides({ request: override }, [])).toEqual({})
  })

  it('preserves the collection while live data is stale', () => {
    const overrides = { request: { ...override, counts: { todo: 2 } } }
    expect(reconcileBoardOverrides(overrides, [request])).toBe(overrides)
  })
})
