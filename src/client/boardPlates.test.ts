import { describe, expect, it } from 'vitest'
import { cardPlates, type BoardPlate } from './boardPlates'

const plate = (fields: Partial<BoardPlate> = {}): BoardPlate => ({
  id: 'plate',
  number: 1,
  stage: 'in_progress',
  startedAt: 1,
  items: [{ requestId: 'hull', copies: 1 }],
  ...fields,
})

describe('cardPlates', () => {
  it('puts a running plate on its cards in the stage it runs in', () => {
    expect(cardPlates([plate()])('hull', 'in_progress')).toEqual({ id: 'plate', number: 1 })
  })

  it('leaves the print’s cards in other stages alone', () => {
    expect(cardPlates([plate()])('hull', 'todo')).toBeUndefined()
  })

  it('flags copies back in Up next after their plate failed', () => {
    expect(cardPlates([plate({ stage: undefined, print: { outcome: 'failed' } })])('hull', 'up_next')).toEqual({
      id: 'plate',
      number: 1,
      failed: true,
    })
  })

  it('stops flagging once the print is on a newer plate', () => {
    expect(
      cardPlates([plate({ stage: undefined, print: { outcome: 'failed' } }), plate({ id: 'again', number: 2, stage: undefined })])(
        'hull',
        'up_next',
      ),
    ).toBeUndefined()
  })
})
