import { describe, expect, it } from 'vitest'
import { prepareUploadFiles, uploadValidationError } from './uploadEntries'

describe('prepareUploadFiles', () => {
  it('creates normalized upload entries', () => {
    const file = new File(['solid model'], 'my_model-file.STL')

    expect(prepareUploadFiles([file], ['resin']).accepted).toMatchObject([
      {
        file,
        name: 'my model file',
        quantity: '1',
        printType: 'resin',
        state: 'pending',
      },
    ])
  })

  it('reports unsupported and empty files', () => {
    const unsupported = new File(['model'], 'model.obj')
    const empty = new File([], 'empty.stl')

    expect(prepareUploadFiles([unsupported, empty], ['filament']).rejected).toEqual([
      'model.obj (not an STL)',
      'empty.stl (over the 5 GB limit)',
    ])
  })
})

describe('uploadValidationError', () => {
  it('requires at least one entry', () => {
    expect(uploadValidationError([])).toBe('Pick at least one STL first.')
  })

  it('requires a print type for every entry', () => {
    const [entry] = prepareUploadFiles([new File(['model'], 'model.stl')], []).accepted

    expect(uploadValidationError([entry])).toBe('Choose resin or filament for every model.')
  })

  it('accepts complete entries', () => {
    const [entry] = prepareUploadFiles([new File(['model'], 'model.stl')], ['resin']).accepted

    expect(uploadValidationError([entry])).toBeUndefined()
  })
})
