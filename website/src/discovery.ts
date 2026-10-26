import { REPOSITORY_URL } from '@/client/sourceCode'
import { HOME_DESCRIPTION, PAGES, SELF_HOSTING_GUIDE_URL, SITE_ORIGIN } from './site'

const SOCIAL_CARD = `${SITE_ORIGIN}/social-card.png`

// What search engines and answer engines read the home page as: the site, and the free open-source application it describes.
const homeStructuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebSite', name: 'STL Quest', url: `${SITE_ORIGIN}/`, description: HOME_DESCRIPTION },
    {
      '@type': 'SoftwareApplication',
      name: 'STL Quest',
      url: `${SITE_ORIGIN}/`,
      description:
        'Collect 3D-print requests in one place, decide what to print next, match jobs to compatible resin and filament printers, and track every copy from queue to ready. Self-host it with Docker, TrueNAS, or Unraid, or use the free hosted version.',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web, Docker, TrueNAS SCALE, Unraid',
      image: SOCIAL_CARD,
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      license: 'https://www.gnu.org/licenses/agpl-3.0.html',
      downloadUrl: SELF_HOSTING_GUIDE_URL,
      sameAs: [REPOSITORY_URL],
    },
  ],
}

const attribute = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')

/** The page served at a path, with or without its trailing slash. */
export function pageAt(pathname: string) {
  const path = pathname.split(/[?#]/)[0].replace(/\/?$/, '/')
  return PAGES.find((page) => page.path === path)
}

/** The tags that differ from page to page, filled into index.html's `<!--page-head-->`. */
export function pageHead(pathname: string) {
  const page = pageAt(pathname) ?? PAGES[0]
  const url = `${SITE_ORIGIN}${page.path}`
  const tags = [
    `<title>${attribute(page.title)}</title>`,
    `<meta name="description" content="${attribute(page.description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:title" content="${attribute(page.title)}" />`,
    `<meta property="og:description" content="${attribute(page.socialDescription ?? page.description)}" />`,
    `<meta property="og:image" content="${SOCIAL_CARD}" />`,
  ]
  if (page.path === '/')
    tags.push(`<script type="application/ld+json">${JSON.stringify(homeStructuredData).replaceAll('<', '\\u003c')}</script>`)
  return tags.join('\n    ')
}

export function sitemapXml() {
  const urls = PAGES.map((page) => `  <url><loc>${SITE_ORIGIN}${page.path}</loc></url>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}
