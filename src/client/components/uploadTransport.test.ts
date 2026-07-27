import { describe, expect, it } from 'vitest'
import { uploadErrorMessage } from './uploadTransport'

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
})
