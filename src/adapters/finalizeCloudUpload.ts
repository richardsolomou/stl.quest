import fs from 'node:fs'
import { Readable } from 'node:stream'
import { undefinedIfMissing, uploadPartMissingError } from './missingFile'

export async function finalizeCloudUpload(
  stagedPath: string,
  relativePath: string,
  stat: () => Promise<{ size: number } | undefined>,
  writeStream: (stream: ReadableStream, size: number, stagedPath: string) => Promise<unknown>,
) {
  const source = await undefinedIfMissing(fs.promises.stat(stagedPath))
  const destination = await stat()
  if (!source && destination) return
  if (!source) throw uploadPartMissingError(stagedPath)
  if (destination && destination.size !== source.size) throw new Error(`upload destination already exists: ${relativePath}`)
  if (!destination) {
    await writeStream(Readable.toWeb(fs.createReadStream(stagedPath)) as ReadableStream, source.size, stagedPath)
  }
  await fs.promises.rm(stagedPath, { force: true })
}
