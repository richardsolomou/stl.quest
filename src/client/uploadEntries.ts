import type { PrintType } from '../core/types'
import { MAX_UPLOAD_BYTES } from '../core/uploadLimits'
import type { UploadEntry } from './components/uploadTypes'

let nextUploadKey = 0

export function prepareUploadFiles(files: Iterable<File>, printTypes: readonly PrintType[]) {
  const accepted: UploadEntry[] = []
  const rejected: string[] = []
  for (const file of files) {
    const rejection = uploadFileRejection(file)
    if (rejection) {
      rejected.push(`${file.name} (${rejection})`)
      continue
    }
    accepted.push({
      key: `f${nextUploadKey++}`,
      file,
      name: file.name
        .replace(/\.(?:stl|3mf)$/i, '')
        .replace(/[_-]+/g, ' ')
        .trim(),
      quantity: '1',
      notes: '',
      sourceUrl: '',
      printType: printTypes[0] ?? '',
      noteOpen: false,
      linkOpen: false,
      state: 'pending',
    })
  }
  return { accepted, rejected }
}

export function uploadValidationError(entries: UploadEntry[]) {
  if (entries.length === 0) return 'Pick at least one STL or 3MF file first.'
  if (entries.some((entry) => !entry.printType)) return 'Choose resin or filament for every model.'
  return undefined
}

export function uploadOutcome(fileCount: number, failedCount: number) {
  return {
    file_count: fileCount,
    succeeded_count: fileCount - failedCount,
    failed_count: failedCount,
    outcome: failedCount === 0 ? 'succeeded' : failedCount === fileCount ? 'failed' : 'partially_succeeded',
  }
}

function uploadFileRejection(file: Pick<File, 'name' | 'size'>) {
  if (!/\.(?:stl|3mf)$/i.test(file.name)) return 'not an STL or 3MF file'
  if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) return 'over the 1 GB limit'
  return undefined
}
