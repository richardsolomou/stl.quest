import { describe, expect, it } from 'vitest'
import { workflow } from './workflow'

describe('production workflow', () => {
  it('keeps stable statuses with print-type-neutral labels', () => {
    expect(workflow.statuses.map((status) => status.id)).toEqual(['todo', 'up_next', 'in_progress', 'post_processing', 'done'])
    expect(workflow.statuses.map((status) => status.label)).toEqual(['Queue', 'Up next', 'Printing', 'Finishing', 'Ready'])
  })
})
