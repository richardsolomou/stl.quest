export function uniqueArchiveNames(fileNames: string[]) {
  const used = new Set<string>()
  return fileNames.map((fileName) => {
    const safeName =
      fileName
        .split(/[\\/]/)
        .at(-1)
        ?.replace(/[\r\n]/g, '') || 'model.stl'
    const extensionIndex = safeName.lastIndexOf('.')
    const stem = extensionIndex > 0 ? safeName.slice(0, extensionIndex) : safeName
    const extension = extensionIndex > 0 ? safeName.slice(extensionIndex) : ''
    let candidate = safeName
    let suffix = 2
    while (used.has(candidate.toLowerCase())) candidate = `${stem} (${suffix++})${extension}`
    used.add(candidate.toLowerCase())
    return candidate
  })
}

export const MAX_ARCHIVE_MODELS = 100
export const MAX_ARCHIVE_FILES = 250

/** Repeats each model once per copy so the archive drops straight into a slicer; undefined when that adds nothing or exceeds the archive limit. */
export function copyDownloadIds(models: { id: string; copies: number }[]): string[] | undefined {
  const ids = models.flatMap(({ id, copies }) => Array.from({ length: copies }, () => id))
  return ids.length > models.length && ids.length <= MAX_ARCHIVE_FILES ? ids : undefined
}
