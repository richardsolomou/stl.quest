import { Cloud, Folder, FolderSync } from 'lucide-react'

export function StorageAdapterIcon({
  adapter,
  className = 'size-4',
}: {
  adapter: 'local' | 'webdav' | 's3' | 'cloud'
  className?: string
}) {
  if (adapter === 'local') return <Folder className={className} aria-hidden="true" />
  if (adapter === 'webdav') return <FolderSync className={className} aria-hidden="true" />
  return <Cloud className={className} aria-hidden="true" />
}
