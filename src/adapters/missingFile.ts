function missingFileError(label: string, path: string) {
  return Object.assign(new Error(`${label} missing: ${path}`), { code: 'ENOENT' as const })
}

export const assetMissingError = (path: string) => missingFileError('asset', path)
export const uploadPartMissingError = (path: string) => missingFileError('upload part', path)
