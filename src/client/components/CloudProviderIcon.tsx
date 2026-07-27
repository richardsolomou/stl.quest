import { SiDropbox, SiGoogledrive } from 'react-icons/si'
import { TbBrandOnedrive } from 'react-icons/tb'
import type { CloudProvider } from '../storageProviders'

export function CloudProviderIcon({ provider, className = 'size-4' }: { provider: CloudProvider; className?: string }) {
  if (provider === 'dropbox') return <SiDropbox className={className} color="#0061ff" aria-hidden="true" />
  if (provider === 'google-drive') return <SiGoogledrive className={className} color="#4285f4" aria-hidden="true" />
  return <TbBrandOnedrive className={className} color="#0078d4" aria-hidden="true" />
}
