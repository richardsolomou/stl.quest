import { describe, expect, it } from 'vitest'
import { droppedFileRole, firstImage } from './coverImage'

describe('droppedFileRole', () => {
  it('makes an image dropped on a linked print its cover', () => {
    expect(droppedFileRole({ hasFile: false }, 'image/png')).toBe('cover')
  })

  it('ignores an image dropped on a print whose model already gives it a picture', () => {
    expect(droppedFileRole({ hasFile: true }, 'image/png')).toBeUndefined()
  })

  it('attaches any other dropped file as the model', () => {
    expect(droppedFileRole({ hasFile: false }, 'model/stl')).toBe('model')
  })
})

describe('firstImage', () => {
  it('picks the image among pasted files', () => {
    const image = new File([], 'cover.png', { type: 'image/png' })

    expect(firstImage([new File([], 'notes.txt', { type: 'text/plain' }), image])).toBe(image)
  })
})
