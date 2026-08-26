import type { PrintType } from '../../core/types'

export type UploadEntry = {
  key: string
  file: File
  name: string
  quantity: string
  notes: string
  sourceUrl: string
  printType: PrintType | ''
  noteOpen: boolean
  linkOpen: boolean
  thumbnail?: string
  state: 'pending' | 'uploading' | 'done' | 'error'
  /** Set when the upload completes an existing link-only request instead of creating a new one. */
  attachToRequestId?: string
}
