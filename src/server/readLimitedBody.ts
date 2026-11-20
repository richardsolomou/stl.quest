/** Returns undefined as soon as the declared or streamed body exceeds the byte limit. */
export async function readLimitedBody(input: Request | Response, limit: number): Promise<Uint8Array<ArrayBuffer> | undefined> {
  if (Number(input.headers.get('content-length')) > limit) {
    await input.body?.cancel()
    return undefined
  }
  if (!input.body) return new Uint8Array()
  const reader = input.body.getReader()
  let buffer = new Uint8Array(0)
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return buffer.subarray(0, length)
      const next = length + value.byteLength
      if (next > limit) {
        await reader.cancel()
        return undefined
      }
      if (next > buffer.length) {
        const expanded = new Uint8Array(Math.min(limit, Math.max(next, buffer.length * 2)))
        expanded.set(buffer)
        buffer = expanded
      }
      buffer.set(value, length)
      length = next
    }
  } finally {
    reader.releaseLock()
  }
}
