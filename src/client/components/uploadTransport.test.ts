import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UploadEntry } from './uploadTypes'
import { isUploadCancelled, uploadErrorMessage, uploadFingerprint, uploadMetadata, uploadPrint, uploadRejection } from './uploadTransport'

const tus = vi.hoisted(() => ({ start: vi.fn() }))
vi.mock('ras-stack/uploads', () => ({
  createTusUpload: () => ({ upload: true }),
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

  it('carries the attach target in the metadata when completing a link-only request', () => {
    const attaching = { ...entry, attachToRequestId: '7f1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d' }

    expect(uploadMetadata(attaching).attachToRequestId).toBe('7f1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d')
  })

  it('leaves the fingerprint untouched for uploads that create a new request', () => {
    expect(uploadFingerprint('workspace', entry)).toBe(uploadFingerprint('workspace', { ...entry }))
    expect(uploadFingerprint('workspace', entry)).not.toContain('undefined')
  })

  it('separates an attach from an otherwise identical new upload', () => {
    const attach = { ...entry, attachToRequestId: '7f1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d' }

    expect(uploadFingerprint('workspace', attach)).not.toBe(uploadFingerprint('workspace', entry))
  })

  it('includes file and request identity in the resume fingerprint', () => {
    expect(uploadFingerprint('workspace', entry)).toBe(
      'stlquest-workspace-model.stl-model/stl-5-123- Model -2.6- note - https://example.com/model -resin',
    )
  })
})

describe('upload cancellation', () => {
  it('asks the shared upload lifecycle to terminate on cancellation', async () => {
    tus.start.mockRejectedValue(new DOMException('Upload cancelled', 'AbortError'))
    const controller = new AbortController()
    const result = uploadPrint('workspace', entry, () => undefined, controller.signal)

    await expect(result).rejects.toSatisfy(isUploadCancelled)
    expect(tus.start).toHaveBeenCalledWith({ upload: true }, { signal: controller.signal, terminateOnAbort: true })
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

  it('explains that too many unfinished uploads are open', () => {
    const error = Object.assign(new Error('tus protocol detail'), {
      originalResponse: { getStatus: () => 429, getBody: () => 'too many incomplete uploads' },
    })

    expect(uploadErrorMessage(error)).toBe('Too many uploads are still in progress. Wait for one to finish, then try again.')
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

describe('uploadRejection', () => {
  it('explains a proxy that blocks a chunk request', () => {
    const error = tusError(403, '<!DOCTYPE html>\n<html lang="en"><head><title>Ban</title></head></html>')

    expect(uploadRejection(error)).toBe('proxy_blocked')
    expect(uploadErrorMessage(error)).toBe(
      'A proxy or firewall in front of STL Quest blocked this upload (HTTP 403). Ask your server admin to allow upload requests to /api/upload.',
    )
  })

  it('explains a proxy that cannot reach STL Quest', () => {
    const error = tusError(502, '<html><body>Bad gateway</body></html>')

    expect(uploadRejection(error)).toBe('proxy_unavailable')
    expect(uploadErrorMessage(error)).toBe('STL Quest did not answer through its proxy (HTTP 502). Try again in a moment.')
  })

  it('does not mistake a proxy body-size page for the storage allowance', () => {
    const error = tusError(413, '<html><head><title>413 Request Entity Too Large</title></head></html>')

    expect(uploadRejection(error)).toBe('proxy_blocked')
  })

  it('treats a rejected upload creation as an explained limit', () => {
    expect(uploadRejection(tusError(429, 'too many incomplete uploads'))).toBe('upload_limit')
    expect(uploadRejection(tusError(429, JSON.stringify({ error: 'too many concurrent upload requests' })))).toBe('upload_limit')
  })

  it('leaves server faults and lost connections for error tracking', () => {
    expect(uploadRejection(tusError(500, 'upload failed'))).toBeUndefined()
    expect(uploadRejection(tusError(423, 'file currently locked'))).toBeUndefined()
    expect(uploadRejection(new Error('Connection lost'))).toBeUndefined()
  })
})

describe('storage quota rejection', () => {
  it('recognizes the upload endpoint refusing on allowance', () => {
    expect(uploadRejection(quotaError('managed storage is full'))).toBe('storage_quota')
  })

  it('does not treat a paused migration as an allowance problem', () => {
    const error = Object.assign(new Error('tus protocol detail'), {
      originalResponse: { getStatus: () => 423, getBody: () => '{}' },
    })

    expect(uploadRejection(error)).not.toBe('storage_quota')
  })
})

function quotaError(detail: string) {
  return Object.assign(new Error('tus protocol detail'), {
    originalResponse: { getStatus: () => 413, getBody: () => JSON.stringify({ error: detail }) },
  })
}

function tusError(status: number, body: string) {
  return Object.assign(new Error('tus protocol detail'), { originalResponse: { getStatus: () => status, getBody: () => body } })
}
