import { Cloud, Server } from 'lucide-react'
import { FaAws } from 'react-icons/fa6'
import { SiBackblaze, SiCloudflare, SiDigitalocean, SiGooglecloud } from 'react-icons/si'
import type { S3Provider } from '../storageProviders'

export function StorageProviderIcon({ provider, className = 'size-4' }: { provider: S3Provider; className?: string }) {
  switch (provider) {
    case 'aws':
      return <FaAws className={`${className} translate-y-0.5`} color="#ff9900" aria-hidden="true" />
    case 'backblaze':
      return <SiBackblaze className={className} color="#e21e29" aria-hidden="true" />
    case 'cloudflare':
      return <SiCloudflare className={className} color="#f38020" aria-hidden="true" />
    case 'digitalocean':
      return <SiDigitalocean className={className} color="#0080ff" aria-hidden="true" />
    case 'google-cloud':
      return <SiGooglecloud className={className} color="#4285f4" aria-hidden="true" />
    case 'custom':
      return <Server className={className} aria-hidden="true" />
    default:
      return <Cloud className={className} aria-hidden="true" />
  }
}
