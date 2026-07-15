import { Cloud, Folder } from 'lucide-react'
import type { StorageConfig } from '../../core/types'

export function StorageAdapterIcon({ adapter, className = 'size-4' }: { adapter: StorageConfig['adapter']; className?: string }) {
  return adapter === 'local' ? <Folder className={className} aria-hidden="true" /> : <Cloud className={className} aria-hidden="true" />
}
