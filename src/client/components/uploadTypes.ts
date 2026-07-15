import type { RequestTarget } from '../fleet'

export type UploadEntry = {
  key: string
  file: File
  name: string
  quantity: string
  notes: string
  sourceUrl: string
  target: RequestTarget
  noteOpen: boolean
  linkOpen: boolean
  thumbnail?: string
  state: 'pending' | 'uploading' | 'done' | 'error'
}
