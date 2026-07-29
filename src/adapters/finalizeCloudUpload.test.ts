import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { finalizeCloudUpload } from './finalizeCloudUpload'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.promises.rm(directory, { recursive: true, force: true })))
})

async function stagedFile(contents = 'model') {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-cloud-upload-'))
  directories.push(directory)
  const stagedPath = path.join(directory, 'upload.part')
  await fs.promises.writeFile(stagedPath, contents)
  return stagedPath
}

describe('finalizeCloudUpload', () => {
  it('streams and removes a new staged file', async () => {
    const stagedPath = await stagedFile()
    const write = vi.fn(async (stream: ReadableStream) => new Response(stream).text())

    await finalizeCloudUpload(stagedPath, 'models/model.stl', async () => undefined, write)

    await expect(fs.promises.stat(stagedPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(write).toHaveBeenCalledOnce()
  })

  it('removes a staged file when the matching destination exists', async () => {
    const stagedPath = await stagedFile()
    const write = vi.fn()

    await finalizeCloudUpload(stagedPath, 'models/model.stl', async () => ({ size: 5 }), write)

    expect(write).not.toHaveBeenCalled()
  })

  it('keeps a staged file when the destination size conflicts', async () => {
    const stagedPath = await stagedFile()

    await expect(finalizeCloudUpload(stagedPath, 'models/model.stl', async () => ({ size: 4 }), vi.fn())).rejects.toThrow(
      'upload destination already exists: models/model.stl',
    )
    await expect(fs.promises.stat(stagedPath)).resolves.toMatchObject({ size: 5 })
  })

  it('accepts a replay when only the destination remains', async () => {
    const stagedPath = path.join(os.tmpdir(), `missing-${crypto.randomUUID()}`)

    await expect(finalizeCloudUpload(stagedPath, 'models/model.stl', async () => ({ size: 5 }), vi.fn())).resolves.toBeUndefined()
  })
})
