import { Cloud, Folder } from 'lucide-react'

export function StorageAdapterIcon({ adapter, className = 'size-4' }: { adapter: 'local' | 's3' | 'cloud'; className?: string }) {
  if (adapter === 'local') return <Folder className={className} aria-hidden="true" />
  return <Cloud className={className} aria-hidden="true" />
}
