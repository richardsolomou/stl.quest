import { Server } from 'lucide-react'
import { FaAws } from 'react-icons/fa6'
import { SiBackblaze, SiCloudflare, SiDigitalocean, SiGooglecloud } from 'react-icons/si'
import type { S3Provider } from '../storageProviders'

export function StorageProviderIcon({ provider }: { provider: S3Provider }) {
  switch (provider) {
    case 'aws':
      return <FaAws className="size-4 translate-y-0.5" color="#ff9900" aria-hidden="true" />
    case 'backblaze':
      return <SiBackblaze className="size-4" color="#e21e29" aria-hidden="true" />
    case 'cloudflare':
      return <SiCloudflare className="size-4" color="#f38020" aria-hidden="true" />
    case 'digitalocean':
      return <SiDigitalocean className="size-4" color="#0080ff" aria-hidden="true" />
    case 'google-cloud':
      return <SiGooglecloud className="size-4" color="#4285f4" aria-hidden="true" />
    case 'custom':
      return <Server className="size-4" aria-hidden="true" />
  }
}
