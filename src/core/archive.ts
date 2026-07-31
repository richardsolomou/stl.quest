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
