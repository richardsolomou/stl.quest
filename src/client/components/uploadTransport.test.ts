import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UploadEntry } from './uploadTypes'
import {
  isStorageQuotaError,
  isUploadCancelled,
  uploadErrorMessage,
  uploadFingerprint,
  uploadMetadata,
  uploadPrint,
} from './uploadTransport'

const tus = vi.hoisted(() => ({ abort: vi.fn(), start: vi.fn() }))
vi.mock('ras-stack/uploads', () => ({
  createTusUpload: () => ({ abort: tus.abort }),
  startTusUpload: tus.start,
}))

const entry = {
  key: 'entry',
  file: new File(['model'], 'model.stl', { type: 'model/stl', lastModified: 123 }),
  name: ' Model ',
  quantity: '2.6',
  notes: ' note ',
  sourceUrl: ' https://example.com/model ',
  printType: 'resin',
  noteOpen: true,
  linkOpen: true,
  state: 'pending',
} satisfies UploadEntry

describe('upload metadata', () => {
  beforeEach(() => {
    tus.abort.mockReset()
    tus.start.mockReset()
  })

  it('normalizes request fields for the upload protocol', () => {
    expect(uploadMetadata(entry)).toEqual({
      filename: 'model.stl',
      name: 'Model',
      quantity: '3',
      notes: 'note',
      sourceUrl: 'https://example.com/model',
      requestedPrintType: 'resin',
    })
  })

  it('omits empty optional fields', () => {
    expect(uploadMetadata({ ...entry, notes: ' ', sourceUrl: ' ' })).toEqual({
      filename: 'model.stl',
      name: 'Model',
      quantity: '3',
      requestedPrintType: 'resin',
    })
  })

  it('includes file and request identity in the resume fingerprint', () => {
    expect(uploadFingerprint('workspace', entry)).toBe(
      'stlquest-workspace-model.stl-model/stl-5-123- Model -2.6- note - https://example.com/model -resin',
    )
  })
})

describe('upload cancellation', () => {
  it('aborts the active resumable upload and reports cancellation', async () => {
    tus.abort.mockResolvedValue(undefined)
    tus.start.mockReturnValue(new Promise(() => undefined))
    const controller = new AbortController()
    const result = uploadPrint('workspace', entry, () => undefined, controller.signal)
    controller.abort()

    await expect(result).rejects.toSatisfy(isUploadCancelled)
    expect(tus.abort).toHaveBeenCalledWith(true)
  })
})

describe('uploadErrorMessage', () => {
  it('explains that a storage migration temporarily paused uploads', () => {
    const error = Object.assign(new Error('tus protocol detail'), {
      originalResponse: {
        getStatus: () => 423,
        getBody: () => JSON.stringify({ error: 'storage migration is in progress — uploads are temporarily paused' }),
      },
    })

    expect(uploadErrorMessage(error)).toBe('Uploads are paused while storage is moving. Wait for the migration to finish.')
  })

  it('keeps unexpected upload errors available for diagnosis', () => {
    expect(uploadErrorMessage(new Error('Connection lost'))).toBe('Connection lost')
  })

  it('distinguishes a model larger than the whole allowance', () => {
    expect(uploadErrorMessage(quotaError('managed storage quota exceeded'))).toBe('This model is larger than your whole storage allowance.')
  })

  it('explains when the remaining allowance is too small', () => {
    expect(uploadErrorMessage(quotaError('managed storage is full'))).toBe('Not enough storage left for this model.')
  })
})

describe('isStorageQuotaError', () => {
  it('recognizes the upload endpoint refusing on allowance', () => {
    expect(isStorageQuotaError(quotaError('managed storage is full'))).toBe(true)
  })

  it('does not treat a paused migration as an allowance problem', () => {
    const error = Object.assign(new Error('tus protocol detail'), {
      originalResponse: { getStatus: () => 423, getBody: () => '{}' },
    })

    expect(isStorageQuotaError(error)).toBe(false)
  })
})

function quotaError(detail: string) {
  return Object.assign(new Error('tus protocol detail'), {
    originalResponse: { getStatus: () => 413, getBody: () => JSON.stringify({ error: detail }) },
  })
}
