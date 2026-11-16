import { describe, expect, it } from 'vitest'
import { currentServerFunction, withServerFunction } from './serverFunction'

describe('server function identity', () => {
  it('names the server function for work it runs, across awaits', async () => {
    const identity = { name: 'saveNote', filename: 'src/server/notes.ts' }
    await expect(
      withServerFunction(identity, async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
        return currentServerFunction()
      }),
    ).resolves.toEqual(identity)
  })

  it('names nothing outside a server function', () => {
    expect(currentServerFunction()).toBeUndefined()
  })

  it('names the innermost server function when calls nest', () => {
    const outer = { name: 'outer', filename: 'outer.ts' }
    const inner = { name: 'inner', filename: 'inner.ts' }
    expect(withServerFunction(outer, () => withServerFunction(inner, currentServerFunction))).toEqual(inner)
  })
})
