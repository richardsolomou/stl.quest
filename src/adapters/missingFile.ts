import { httpStatus } from './retryableError'

function missingFileError(label: string, path: string) {
  return Object.assign(new Error(`${label} missing: ${path}`), { code: 'ENOENT' as const })
}

export const assetMissingError = (path: string) => missingFileError('asset', path)
export const uploadPartMissingError = (path: string) => missingFileError('upload part', path)

export function isAssetMissing(error: unknown) {
  return (error as { code?: string }).code === 'ENOENT' || httpStatus(error) === 404
}

/** Resolves to undefined instead of rejecting when the file or folder does not exist. */
export function undefinedIfMissing<T>(promise: Promise<T>): Promise<T | undefined> {
  return promise.catch((error: NodeJS.ErrnoException) => (error.code === 'ENOENT' ? undefined : Promise.reject(error)))
}
