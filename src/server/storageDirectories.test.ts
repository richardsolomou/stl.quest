import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { storageDirectories } from './storageDirectories'

describe('storageDirectories', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-directories-'))
  })

  afterEach(async () => fs.promises.rm(root, { recursive: true, force: true }))

  it('returns directories and directory symlinks in name order', async () => {
    const target = path.join(root, 'target')
    await fs.promises.mkdir(path.join(root, 'folder'))
    await fs.promises.mkdir(target)
    await fs.promises.symlink(target, path.join(root, 'linked-folder'))
    await fs.promises.writeFile(path.join(root, 'file.txt'), 'file')

    await expect(storageDirectories(root)).resolves.toEqual([
      { name: 'folder', path: path.join(root, 'folder') },
      { name: 'linked-folder', path: path.join(root, 'linked-folder') },
      { name: 'target', path: target },
    ])
  })
})
