import { httpStatus } from './retryableError'

function missingFileError(label: string, path: string) {
  return Object.assign(new Error(`${label} missing: ${path}`), { code: 'ENOENT' as const })
}

export const assetMissingError = (path: string) => missingFileError('asset', path)
export const uploadPartMissingError = (path: string) => missingFileError('upload part', path)

export function isAssetMissing(error: unknown) {
  return (error as { code?: string }).code === 'ENOENT' || httpStatus(error) === 404
}
