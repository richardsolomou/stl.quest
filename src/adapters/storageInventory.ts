import { isStorageScaffoldFolder } from '../core/assetKeys'
import type { StorageInventory, StorageInventoryEntry } from '../core/types'

export class StorageInventoryBuilder {
  private files = 0
  private folders = new Set<string>()
  private bytes = 0
  private entries: StorageInventoryEntry[] = []

  constructor(private maxEntries = 100) {}

  addFile(path: string, bytes: number) {
    this.files++
    this.bytes += bytes
    this.push({ path, type: 'file', bytes })
  }

  addFolder(path: string) {
    if (isStorageScaffoldFolder(path) || this.folders.has(path)) return
    this.folders.add(path)
    this.push({ path, type: 'folder' })
  }

  result(): StorageInventory {
    return {
      files: this.files,
      folders: this.folders.size,
      bytes: this.bytes,
      entries: this.entries,
      truncated: this.files + this.folders.size > this.entries.length,
    }
  }

  private push(entry: StorageInventoryEntry) {
    if (this.entries.length < this.maxEntries) this.entries.push(entry)
  }
}
