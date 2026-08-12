import { describe, expect, it } from 'vitest'
import { prepareUploadFiles, uploadOutcome, uploadValidationError } from './uploadEntries'

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

  it('accepts 3MF files and removes their extension from the request name', () => {
    const file = new File(['3mf'], 'multi_part-model.3MF')
    expect(prepareUploadFiles([file], ['filament']).accepted[0]).toMatchObject({ file, name: 'multi part model' })
  })

  it('reports unsupported and empty files', () => {
    const unsupported = new File(['model'], 'model.obj')
    const empty = new File([], 'empty.stl')

    expect(prepareUploadFiles([unsupported, empty], ['filament']).rejected).toEqual([
      'model.obj (not an STL or 3MF file)',
      'empty.stl (over the 1 GB limit)',
    ])
  })
})

describe('uploadValidationError', () => {
  it('requires at least one entry', () => {
    expect(uploadValidationError([])).toBe('Pick at least one STL or 3MF file first.')
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
