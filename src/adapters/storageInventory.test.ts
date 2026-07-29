import { describe, expect, it } from 'vitest'
import { StorageInventoryBuilder } from './storageInventory'

describe('StorageInventoryBuilder', () => {
  it('aggregates files and unique non-scaffold folders', () => {
    const inventory = new StorageInventoryBuilder()
    inventory.addFolder('models')
    inventory.addFolder('projects')
    inventory.addFolder('projects')
    inventory.addFile('projects/a.stl', 12)
    inventory.addFile('projects/b.stl', 30)

    expect(inventory.result()).toEqual({
      files: 2,
      folders: 1,
      bytes: 42,
      entries: [
        { path: 'projects', type: 'folder' },
        { path: 'projects/a.stl', type: 'file', bytes: 12 },
        { path: 'projects/b.stl', type: 'file', bytes: 30 },
      ],
      truncated: false,
    })
  })

  it('caps returned entries while preserving totals', () => {
    const inventory = new StorageInventoryBuilder()
    for (let index = 0; index < 101; index++) inventory.addFile(`models/${index}.stl`, index)

    expect(inventory.result()).toMatchObject({ files: 101, bytes: 5_050, truncated: true })
    expect(inventory.result().entries).toHaveLength(100)
  })
})
