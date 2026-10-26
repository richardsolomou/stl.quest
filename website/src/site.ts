import { CLOUD_STORAGE_PROVIDER_NAMES } from '@/core/auth'
import { REPOSITORY_URL } from '@/client/sourceCode'

export const SITE_ORIGIN = 'https://stl.quest'
export const SIGN_UP_URL = 'https://app.stl.quest/?signup=true'
export const SELF_HOSTING_GUIDE_URL = `${REPOSITORY_URL}#run-it-`
export const ISSUES_URL = `${REPOSITORY_URL}/issues`

export const LOCAL_STORAGE = 'Your machine'
export const STORAGE_PROVIDERS = ['S3-compatible', ...Object.values(CLOUD_STORAGE_PROVIDER_NAMES), 'WebDAV', LOCAL_STORAGE]

export const NAS_CATALOGUES = [
  ['truenas', 'TrueNAS', 'https://apps.truenas.com/catalog/stlquest_community/'],
  ['unraid', 'Unraid', 'https://ca.unraid.net/apps?q=STL-Quest'],
] as const

type SitePage = { path: string; title: string; description: string; socialDescription?: string }

export const HOME_DESCRIPTION = 'STL Quest is a free, open-source request and production queue for people who 3D print things for others.'

/** Every page the build prerenders, under the address it is served and listed at. */
export const PAGES: readonly SitePage[] = [
  {
    path: '/',
    title: 'STL Quest — A free, open-source 3D-print queue',
    description: HOME_DESCRIPTION,
    socialDescription: 'Keep requests, printers, and progress together. Self-host it or use the free hosted version.',
  },
  {
    path: '/terms/',
    title: 'Terms of Service — STL Quest',
    description: 'Terms governing use of the STL Quest website and hosted service.',
  },
  { path: '/privacy/', title: 'Privacy Policy — STL Quest', description: 'How STL Quest collects, uses, and protects information.' },
]
