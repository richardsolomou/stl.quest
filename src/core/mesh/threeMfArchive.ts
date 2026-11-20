import { Unzip, UnzipInflate, unzipSync } from 'fflate'
import { InvalidMeshError } from './stl'

export const isModelPart = (name: string) => /^3D\/.*\.model$/i.test(name)
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
const MAX_ENTRIES = 4096

export function readThreeMfArchive(file: Uint8Array, include: (name: string) => boolean) {
  if (file.length < 4 || file[0] !== 0x50 || file[1] !== 0x4b || file[2] !== 3 || file[3] !== 4) throw new Error('invalid ZIP header')
  let directoryEntries = 0
  // Streaming inflation consumes local members; the directory must also be present for a complete ZIP.
  unzipSync(file, {
    filter: () => {
      if (++directoryEntries > MAX_ENTRIES) throw new InvalidMeshError('too many 3MF archive entries')
      return false
    },
  })
  const entries: Record<string, Uint8Array> = Object.create(null)
  let remaining = Math.min(MAX_ARCHIVE_BYTES, Math.max(1024 * 1024, file.length * 64))
  let count = 0
  const archive = new Unzip((entry) => {
    if (++count > MAX_ENTRIES) throw new InvalidMeshError('too many 3MF archive entries')
    if (!include(entry.name)) return
    const chunks: Uint8Array[] = []
    let length = 0
    if (entry.originalSize !== undefined && entry.originalSize > remaining) throw new InvalidMeshError('3MF exceeds the extraction budget')
    entry.ondata = (error, chunk, final) => {
      if (error) throw error
      remaining -= chunk.byteLength
      if (remaining < 0) throw new InvalidMeshError('3MF exceeds the extraction budget')
      length += chunk.byteLength
      if (chunk.byteLength) chunks.push(chunk)
      if (final) {
        const bytes = new Uint8Array(length)
        let offset = 0
        for (const part of chunks) {
          bytes.set(part, offset)
          offset += part.length
        }
        entries[entry.name] = bytes
      }
    }
    entry.start()
  })
  archive.register(UnzipInflate)
  // Limit the output a single synchronous inflater push can produce before ondata checks the actual byte count.
  const chunkSize = 8192
  for (let offset = 0; offset < file.length; offset += chunkSize)
    archive.push(file.subarray(offset, offset + chunkSize), offset + chunkSize >= file.length)
  if (count !== directoryEntries) throw new InvalidMeshError('incomplete 3MF archive')
  return entries
}

export function modelXml(bytes: Uint8Array) {
  const xml = new TextDecoder().decode(bytes)
  let tags = 0
  for (let index = xml.indexOf('<'); index !== -1; index = xml.indexOf('<', index + 1)) {
    const end = xml.startsWith('<!--', index)
      ? '-->'
      : xml.startsWith('<![CDATA[', index)
        ? ']]>'
        : xml.startsWith('<?', index)
          ? '?>'
          : undefined
    if (end) {
      index = xml.indexOf(end, index + 2)
      if (index === -1) throw new InvalidMeshError('unterminated 3MF markup')
    } else if (xml.startsWith('<!DOCTYPE', index)) throw new InvalidMeshError('3MF document types are unsupported')
    else if (++tags > 1_000_000) throw new InvalidMeshError('3MF exceeds the XML element budget')
  }
  return xml
}
