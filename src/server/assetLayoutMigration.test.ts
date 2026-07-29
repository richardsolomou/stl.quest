import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalAssetStore } from '../adapters/filesystem'
import { createAssetKey } from '../core/assetKeys'
import type { PrintRequest } from '../core/types'
import { assetMigrations, runAssetMigrations } from './assetMigrations'
import type { AssetMigration } from './assetMigrations/types'

const requestId = '00000000-0000-4000-8000-000000000001'

describe('stable asset layout migration', () => {
  let root: string
  let assets: LocalAssetStore

  beforeEach(async () => {
    root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-asset-layout-'))
    assets = new LocalAssetStore(root)
    await assets.initialize()
  })

  afterEach(async () => fs.promises.rm(root, { recursive: true, force: true }))

  it('moves a legacy model and updates its stored path', async () => {
    const legacyPath = 'in-progress/legacy-model.stl'
    await assets.write(legacyPath, new TextEncoder().encode('mesh'))
    const repository = migrationRepository(legacyPath)

    await runAssetMigrations(repository, assets)

    const destination = createAssetKey(requestId, 'Original Model.stl')
    expect(await assets.exists(legacyPath)).toBe(false)
    expect(await assets.exists(destination)).toBe(true)
    expect((await repository.getRequest(requestId))?.filePath).toBe(destination)
    expect(await repository.listAssetMigrations()).toEqual(['0001_stable_model_paths', '0002_flat_generated_asset_paths'])
    await expect(fs.promises.stat(path.join(root, 'in-progress'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('resumes after the model moved but before its database path changed', async () => {
    const legacyPath = 'todo/legacy-model.stl'
    const destination = createAssetKey(requestId, 'Original Model.stl')
    await assets.write(legacyPath, new TextEncoder().encode('mesh'))
    await assets.ensureMoved(legacyPath, destination)
    const repository = migrationRepository(legacyPath)

    await runAssetMigrations(repository, assets)

    expect((await repository.getRequest(requestId))?.filePath).toBe(destination)
    expect(await repository.listAssetMigrations()).toEqual(['0001_stable_model_paths', '0002_flat_generated_asset_paths'])
  })

  it('does not rerun a completed migration', async () => {
    const repository = migrationRepository('todo/missing.stl')
    await repository.recordAssetMigration('0001_stable_model_paths')

    await runAssetMigrations(repository, assets)

    expect((await repository.getRequest(requestId))?.filePath).toBe('todo/missing.stl')
  })

  it('stops without changing the database when the destination conflicts', async () => {
    const legacyPath = 'todo/legacy-model.stl'
    const destination = createAssetKey(requestId, 'Original Model.stl')
    await assets.write(legacyPath, new TextEncoder().encode('mesh'))
    await assets.write(destination, new TextEncoder().encode('different mesh'))
    const repository = migrationRepository(legacyPath)

    await expect(runAssetMigrations(repository, assets)).rejects.toThrow('destination already exists')

    expect((await repository.getRequest(requestId))?.filePath).toBe(legacyPath)
    expect(await repository.listAssetMigrations()).toEqual([])
    await expect(fs.promises.stat(path.join(root, 'todo'))).resolves.toBeDefined()
  })

  it('preserves unknown files in legacy directories', async () => {
    await assets.write('todo/legacy-model.stl', new TextEncoder().encode('mesh'))
    await assets.write('todo/untracked.stl', new TextEncoder().encode('unknown'))
    const repository = migrationRepository('todo/legacy-model.stl')

    await runAssetMigrations(repository, assets)

    expect(await assets.exists('todo/untracked.stl')).toBe(true)
    expect(await repository.listAssetMigrations()).toEqual(['0001_stable_model_paths', '0002_flat_generated_asset_paths'])
  })

  it('runs every missing migration in order after skipped releases', async () => {
    const repository = migrationRepository('models/current.stl')
    const calls: string[] = []
    const migrations: AssetMigration[] = [migration('0001_first', calls), migration('0002_second', calls), migration('0003_third', calls)]
    await repository.recordAssetMigration('0001_first')

    await runAssetMigrations(repository, assets, migrations)

    expect(calls).toEqual(['0002_second', '0003_third'])
    expect(await repository.listAssetMigrations()).toEqual(['0001_first', '0002_second', '0003_third'])
  })

  it('keeps the journal at the last successful migration', async () => {
    const repository = migrationRepository('models/current.stl')
    const migrations: AssetMigration[] = [
      { id: '0001_first', run: async () => undefined },
      { id: '0002_fails', run: async () => Promise.reject(new Error('migration failed')) },
      { id: '0003_never_runs', run: async () => undefined },
    ]

    await expect(runAssetMigrations(repository, assets, migrations)).rejects.toThrow('migration failed')

    expect(await repository.listAssetMigrations()).toEqual(['0001_first'])
  })

  it('moves generated assets out of the legacy internal folder', async () => {
    const thumbnailPath = '.stlquest/thumbnails/model.png'
    const previewPath = '.stlquest/previews/model.phm'
    await assets.write(thumbnailPath, new TextEncoder().encode('thumbnail'))
    await assets.write(previewPath, new TextEncoder().encode('preview'))
    const repository = migrationRepository('models/current.stl', { thumbnailPath, previewPath })
    await repository.recordAssetMigration('0001_stable_model_paths')

    await runAssetMigrations(repository, assets)

    expect((await repository.getRequest(requestId))?.thumbnailPath).toBe('thumbnails/model.png')
    expect((await repository.getRequest(requestId))?.previewPath).toBe('previews/model.phm')
    expect(await assets.exists('thumbnails/model.png')).toBe(true)
    expect(await assets.exists('previews/model.phm')).toBe(true)
  })

  it('keeps the released migration id append-only', () => {
    expect(assetMigrations.map((entry) => entry.id)).toEqual(['0001_stable_model_paths', '0002_flat_generated_asset_paths'])
  })
})

function migration(id: string, calls: string[]): AssetMigration {
  return { id, run: async () => void calls.push(id) }
}

function migrationRepository(filePath: string, generated: Pick<PrintRequest, 'thumbnailPath' | 'previewPath'> = {}) {
  let request = {
    id: requestId,
    name: 'Original Model',
    fileName: 'Original Model.stl',
    filePath,
    ...generated,
  } as PrintRequest
  const appliedMigrations = new Set<string>()
  return {
    completeAssetGeneration: async (id: string, paths: { thumbnailPath?: string; previewPath?: string }) => {
      if (id === request.id) request = { ...request, ...paths }
    },
    getRequest: async (id: string) => (id === request.id ? request : undefined),
    listAssetMigrations: async () => [...appliedMigrations].sort(),
    listRequests: async () => [request],
    recordAssetMigration: async (id: string) => void appliedMigrations.add(id),
    updateRequestFilePath: async (id: string, previousPath: string, nextPath: string) => {
      if (id !== request.id || previousPath !== request.filePath) return false
      request = { ...request, filePath: nextPath }
      return true
    },
  }
}
