import { describe, expect, it } from 'vitest'
import { streamChunks } from './streamChunks'

describe('streamChunks', () => {
  it('combines small reads into fixed-size upload chunks', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1, 2, 3]))
        controller.enqueue(Uint8Array.from([4, 5]))
        controller.enqueue(Uint8Array.from([6, 7, 8, 9]))
        controller.close()
      },
    })

    const chunks: number[][] = []
    for await (const chunk of streamChunks(stream, 4)) chunks.push([...chunk])

    expect(chunks).toEqual([[1, 2, 3, 4], [5, 6, 7, 8], [9]])
  })
})
