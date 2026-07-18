import { describe, expect, it } from 'vitest'
import { parsePlateBrief, plateBriefCopyIds, serializePlateBrief } from './plateBrief'

describe('plate brief', () => {
  it('round trips selected request ids', () => {
    const requestIds = ['first', 'second']

    expect(parsePlateBrief(serializePlateBrief(requestIds))).toEqual(requestIds)
  })

  it('expands request ids into first-copy planner ids', () => {
    expect(plateBriefCopyIds(['model', 'other'])).toEqual(['model:1', 'other:1'])
  })

  it('removes empty and duplicate ids', () => {
    expect(parsePlateBrief('first..first.second ')).toEqual(['first', 'second'])
  })
})
