import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyWritableDirectory } from './writableDirectory'

const directories: string[] = []
afterEach(
  async () => await Promise.all(directories.splice(0).map((directory) => fs.promises.rm(directory, { recursive: true, force: true }))),
)

describe('verifyWritableDirectory', () => {
  it('writes and removes a health probe', async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-writable-'))
    directories.push(directory)
    await verifyWritableDirectory(directory)
    await expect(fs.promises.readdir(directory)).resolves.toEqual([])
  })
})
