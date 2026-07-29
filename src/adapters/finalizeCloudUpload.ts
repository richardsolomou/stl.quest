import fs from 'node:fs'
import { Readable } from 'node:stream'

export async function finalizeCloudUpload(
  stagedPath: string,
  relativePath: string,
  stat: () => Promise<{ size: number } | undefined>,
  writeStream: (stream: ReadableStream, size: number) => Promise<unknown>,
) {
  const source = await fs.promises.stat(stagedPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  const destination = await stat()
  if (!source && destination) return
  if (!source) throw Object.assign(new Error(`upload part missing: ${stagedPath}`), { code: 'ENOENT' })
  if (destination && destination.size !== source.size) throw new Error(`upload destination already exists: ${relativePath}`)
  if (!destination) {
    await writeStream(Readable.toWeb(fs.createReadStream(stagedPath)) as ReadableStream, source.size)
  }
  await fs.promises.rm(stagedPath, { force: true })
}
