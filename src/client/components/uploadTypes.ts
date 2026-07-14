export type UploadEntry = {
  key: string
  file: File
  name: string
  quantity: string
  notes: string
  sourceUrl: string
  printerId?: string
  noteOpen: boolean
  linkOpen: boolean
  thumbnail?: string
  state: 'pending' | 'uploading' | 'done' | 'error'
}
