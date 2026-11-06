import type { PrintType } from '../core/types'
import { MAX_UPLOAD_BYTES } from '../core/uploadLimits'
import type { Messages } from '../core/i18n'
import type { UploadEntry } from './components/uploadTypes'

let nextUploadKey = 0

type RequestMessages = Messages['requests']

export function prepareUploadFiles(files: Iterable<File>, printTypes: readonly PrintType[], t: RequestMessages) {
  const accepted: UploadEntry[] = []
  const rejected: string[] = []
  for (const file of files) {
    const rejection = uploadFileRejection(file, t)
    if (rejection) {
      rejected.push(t.upload.rejectedFile(file.name, rejection))
      continue
    }
    accepted.push({
      key: `f${nextUploadKey++}`,
      file,
      name: file.name
        .replace(/\.(?:stl|3mf|obj)$/i, '')
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

export function uploadValidationError(entries: UploadEntry[], t: RequestMessages) {
  if (entries.length === 0) return t.validation.noFiles
  if (entries.some((entry) => !entry.printType)) return t.validation.choosePrintTypeEach
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

function uploadFileRejection(file: Pick<File, 'name' | 'size'>, t: RequestMessages) {
  if (!/\.(?:stl|3mf|obj)$/i.test(file.name)) return t.upload.notModelFile
  if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) return t.upload.overLimit
  return undefined
}
