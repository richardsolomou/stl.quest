import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalAssetStore } from './filesystem'

describe('LocalAssetStore', () => {
  let root: string
  let data: string
  let store: LocalAssetStore

  beforeEach(async () => {
    root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-prints-'))
    data = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-data-'))
    store = new LocalAssetStore(root, data)
    await store.initialize()
  })
  afterEach(async () => Promise.all([fs.promises.rm(root, { recursive: true }), fs.promises.rm(data, { recursive: true })]).then(() => undefined))

  it('refuses paths outside the storage root', () => {
    expect(() => store.absolute('../secret')).toThrow()
    expect(store.absolute('todo/model.stl')).toBe(path.join(root, 'todo/model.stl'))
  })

  it('finalizes and moves logical assets through workflow folders', async () => {
    const part = store.uploadPart('valid-upload-id')
    await fs.promises.writeFile(part, 'stl')
    await store.finalizeUpload(part, 'todo/model.stl')
    const moved = await store.move('todo/model.stl', 'done')
    expect(moved).toBe(path.join('done', 'model.stl'))
    expect(await fs.promises.readFile(store.absolute(moved), 'utf8')).toBe('stl')
  })

  it('finalizes across separate filesystems without exposing a partial destination', async () => {
    const part = store.uploadPart('cross-device-upload')
    await fs.promises.writeFile(part, 'complete stl')
    const rename = fs.promises.rename.bind(fs.promises)
    const spy = vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(Object.assign(new Error('cross device'), { code: 'EXDEV' })).mockImplementation(rename)
    await store.finalizeUpload(part, 'todo/cross-device.stl')
    expect(await fs.promises.readFile(store.absolute('todo/cross-device.stl'), 'utf8')).toBe('complete stl')
    await expect(fs.promises.stat(part)).rejects.toMatchObject({ code: 'ENOENT' })
    spy.mockRestore()
  })

  it('does not rename a same-filesystem upload before syncing its contents', async () => {
    const part = store.uploadPart('durable-upload-id')
    await fs.promises.writeFile(part, 'complete stl')
    const open = fs.promises.open.bind(fs.promises)
    const spy = vi.spyOn(fs.promises, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await open(file, flags, mode)
      if (String(file) === part) vi.spyOn(handle, 'sync').mockRejectedValueOnce(new Error('sync failed'))
      return handle
    })
    await expect(store.finalizeUpload(part, 'todo/not-visible.stl')).rejects.toThrow('sync failed')
    expect(await fs.promises.readFile(part, 'utf8')).toBe('complete stl')
    await expect(fs.promises.stat(store.absolute('todo/not-visible.stl'))).rejects.toMatchObject({ code: 'ENOENT' })
    spy.mockRestore()
  })

  it('sweeps only stale managed upload parts and tolerates disappearing files', async () => {
    const stale = store.uploadPart('stale-upload-id')
    const active = store.uploadPart('active-upload-id')
    const unrelated = path.join(data, 'uploads', 'keep.txt')
    await Promise.all([fs.promises.writeFile(stale, 'old'), fs.promises.writeFile(active, 'active'), fs.promises.writeFile(unrelated, 'keep')])
    const old = new Date(Date.now() - 2 * 86_400_000)
    await Promise.all([fs.promises.utimes(stale, old, old), fs.promises.utimes(active, old, old)])
    await store.sweepUploads(new Set(['active-upload-id']))
    await expect(fs.promises.stat(stale)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.promises.readFile(active, 'utf8')).toBe('active')
    expect(await fs.promises.readFile(unrelated, 'utf8')).toBe('keep')
  })

  it('moves assets to managed trash', async () => {
    await store.write('todo/remove.stl', new TextEncoder().encode('stl'))
    const trashPath = await store.trash('todo/remove.stl')
    expect(trashPath).toBeTruthy()
    expect(await fs.promises.readFile(store.absolute(trashPath!), 'utf8')).toBe('stl')
    await expect(fs.promises.stat(store.absolute('todo/remove.stl'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
