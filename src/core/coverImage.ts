/** Covers fill a board card or the print dialog, so a cover is never stored or asked for wider than this. */
export const COVER_WIDTH = 1200
/** The largest cover a print keeps, whether fetched from its source link or supplied by a person. */
export const MAX_COVER_BYTES = 5 * 1024 * 1024

/** The image type its magic number declares, so a declared content type or file extension is never trusted. */
export function imageContentType(bytes: Uint8Array) {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (new TextDecoder().decode(bytes.subarray(0, 6)).match(/^GIF8[79]a$/)) return 'image/gif'
  if (new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP') {
    return 'image/webp'
  }
  const boxType = new TextDecoder().decode(bytes.subarray(4, 12))
  if (boxType === 'ftypavif' || boxType === 'ftypavis') return 'image/avif'
  return undefined
}

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value)
}
