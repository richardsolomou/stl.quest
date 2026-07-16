export async function* streamChunks(stream: ReadableStream, limit: number) {
  const reader = stream.getReader()
  let chunks: Uint8Array[] = []
  let bufferedBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      let remaining = value
      while (remaining.byteLength) {
        const part = remaining.subarray(0, limit - bufferedBytes)
        chunks.push(part)
        bufferedBytes += part.byteLength
        remaining = remaining.subarray(part.byteLength)
        if (bufferedBytes === limit) {
          yield Buffer.concat(chunks, bufferedBytes)
          chunks = []
          bufferedBytes = 0
        }
      }
    }
    if (bufferedBytes) yield Buffer.concat(chunks, bufferedBytes)
  } finally {
    reader.releaseLock()
  }
}
