import { describe, expect, it } from 'vitest'
import { messagesFor } from '../core/i18n'
import { prepareUploadFiles, uploadOutcome, uploadValidationError } from './uploadEntries'

const t = messagesFor('en').requests

describe('prepareUploadFiles', () => {
  it('creates normalized upload entries', () => {
    const file = new File(['solid model'], 'my_model-file.STL')

    expect(prepareUploadFiles([file], ['resin'], t).accepted).toMatchObject([
      {
        file,
        name: 'my model file',
        quantity: '1',
        printType: 'resin',
        state: 'pending',
      },
    ])
  })

  it('accepts 3MF files and removes their extension from the request name', () => {
    const file = new File(['3mf'], 'multi_part-model.3MF')
    expect(prepareUploadFiles([file], ['filament'], t).accepted[0]).toMatchObject({ file, name: 'multi part model' })
  })

  it('accepts OBJ files and removes their extension from the request name', () => {
    const file = new File(['v 0 0 0'], 'multi_part-model.OBJ')
    expect(prepareUploadFiles([file], ['filament'], t).accepted[0]).toMatchObject({ file, name: 'multi part model' })
  })

  it('reports unsupported and empty files', () => {
    const unsupported = new File(['model'], 'model.ply')
    const empty = new File([], 'empty.stl')

    expect(prepareUploadFiles([unsupported, empty], ['filament'], t).rejected).toEqual([
      'model.ply (not an STL, 3MF, or OBJ file)',
      'empty.stl (over the 1 GB limit)',
    ])
  })
})

describe('uploadValidationError', () => {
  it('requires at least one entry', () => {
    expect(uploadValidationError([], t)).toBe('Pick at least one STL, 3MF, or OBJ file first.')
  })

  it('requires a print type for every entry', () => {
    const [entry] = prepareUploadFiles([new File(['model'], 'model.stl')], [], t).accepted

    expect(uploadValidationError([entry], t)).toBe('Choose resin or filament for every model.')
  })

  it('accepts complete entries', () => {
    const [entry] = prepareUploadFiles([new File(['model'], 'model.stl')], ['resin'], t).accepted

    expect(uploadValidationError([entry], t)).toBeUndefined()
  })
})

describe('uploadOutcome', () => {
  it('describes a partial batch without exposing file details', () => {
    expect(uploadOutcome(4, 1)).toEqual({
      file_count: 4,
      succeeded_count: 3,
      failed_count: 1,
      outcome: 'partially_succeeded',
    })
  })
})
