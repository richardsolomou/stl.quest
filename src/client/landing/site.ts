import { CLOUD_STORAGE_PROVIDER_NAMES } from '@/core/auth'
import { REPOSITORY_URL } from '@/client/sourceCode'

export const SITE_ORIGIN = 'https://stl.quest'
export const SIGN_IN_PATH = '/sign-in'
export const SIGN_UP_PATH = '/sign-in?signup=true'
export const SELF_HOSTING_GUIDE_URL = `${REPOSITORY_URL}#run-it-`

export const LOCAL_STORAGE = 'Your machine'
export const STORAGE_PROVIDERS = ['S3-compatible', ...Object.values(CLOUD_STORAGE_PROVIDER_NAMES), 'WebDAV', LOCAL_STORAGE]

export const NAS_CATALOGUES = [
  ['truenas', 'TrueNAS', 'https://apps.truenas.com/catalog/stlquest_community/'],
  ['unraid', 'Unraid', 'https://ca.unraid.net/apps?q=STL-Quest'],
] as const

/** What STL Quest leaves to other tools, as the page draws it and `llms.txt` states it: the job, who does it, and the clause. */
export const OUTSIDE_THE_PRODUCT = [
  { job: 'Slicing', instead: 'Your slicer keeps orientation, supports, infill, and material use.', clause: 'slice models' },
  { job: 'Printer control', instead: "Start and watch prints from your printer's own app.", clause: 'control printers' },
  { job: 'Payments', instead: 'The quote is a number; charging for it stays with you.', clause: 'take payments for prints' },
  { job: 'Shipping', instead: 'Ready means ready to collect, not posted.', clause: 'handle shipping' },
  {
    job: 'Marketplace',
    instead: 'Workspaces are private: no public gallery or storefront.',
    clause: 'host a public gallery or marketplace',
  },
] as const

export type SitePage = { path: string; title: string; description: string; socialDescription?: string }

export const HOME_DESCRIPTION = 'STL Quest is a free, open-source request and production queue for people who 3D print things for others.'

/** Every page the build prerenders, under the address it is served and listed at. */
export const PAGES: readonly SitePage[] = [
  {
    path: '/',
    title: 'STL Quest — A free, open-source 3D-print queue',
    description: HOME_DESCRIPTION,
    socialDescription:
      'Take requests, plan the queue, quote jobs, and track every copy to pickup. Self-host it or use the free hosted version.',
  },
  {
    path: '/terms',
    title: 'Terms of Service — STL Quest',
    description: 'Terms governing use of the STL Quest website and hosted service.',
  },
  { path: '/privacy', title: 'Privacy Policy — STL Quest', description: 'How STL Quest collects, uses, and protects information.' },
]

/** The hosted service greets signed-out visitors with the landing page; a self-hosted install shows its sign-in and setup screen. */
export const showsLanding = (session: { hosted: boolean; identity: unknown }) => session.hosted && !session.identity

/** The marketing and legal pages are written only in English, so they keep `<html lang="en">` whatever the visitor's language. */
export const showsEnglishLandingPage = (session: { hosted: boolean; identity: unknown }, pathname: string) =>
  pathname === '/' ? showsLanding(session) : session.hosted && (pathname === '/home' || PAGES.some((page) => page.path === pathname))
