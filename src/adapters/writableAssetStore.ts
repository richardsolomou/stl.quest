import crypto from 'node:crypto'

export async function verifyWritableAssetStore(options: {
  write(path: string, bytes: Uint8Array): Promise<unknown>
  read?: (path: string) => Promise<{ stream: ReadableStream }>
  remove(path: string): Promise<unknown>
}) {
  const probe = `.stlquest-health-${crypto.randomUUID()}`
  await options.write(probe, options.read ? new Uint8Array([1]) : new Uint8Array())
  if (options.read) {
    const readable = await options.read(probe)
    await readable.stream.cancel()
  }
  await options.remove(probe)
}
