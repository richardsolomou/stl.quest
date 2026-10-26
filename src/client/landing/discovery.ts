import type { JSX } from 'react'
import oswald500 from '@fontsource/oswald/files/oswald-latin-500-normal.woff2?url'
import plexMono400 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?url'
import plexSans400 from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2?url'
import plexSans500 from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff2?url'
import { REPOSITORY_URL } from '@/client/sourceCode'
import landingCss from './landing.css?url'
import { HOME_DESCRIPTION, PAGES, SELF_HOSTING_GUIDE_URL, SITE_ORIGIN, type SitePage } from './site'

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

/** The router renders and escapes `script:ld+json` entries, but its React types admit only meta elements. */
const structuredData = (data: Record<string, unknown>) => ({ 'script:ld+json': data }) as JSX.IntrinsicElements['meta']

/**
 * A landing page's head. It overrides the application's defaults, including the `noindex` every
 * other page carries, and loads the landing stylesheet with the faces above the fold preloaded.
 */
export function landingHead(page: SitePage) {
  const url = `${SITE_ORIGIN}${page.path}`
  return {
    meta: [
      { title: page.title },
      { name: 'description', content: page.description },
      { name: 'robots', content: 'index, follow' },
      { name: 'theme-color', content: '#15171c' },
      { property: 'og:type', content: 'website' },
      { property: 'og:url', content: url },
      { property: 'og:title', content: page.title },
      { property: 'og:description', content: page.socialDescription ?? page.description },
      { property: 'og:image', content: SOCIAL_CARD },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      {
        property: 'og:image:alt',
        content: 'The STL Quest request board, with prints grouped into queue, printing, finishing, and ready columns.',
      },
      { name: 'twitter:card', content: 'summary_large_image' },
      ...(page.path === '/' ? [structuredData(homeStructuredData)] : []),
    ],
    links: [
      { rel: 'canonical', href: url },
      { rel: 'stylesheet', href: landingCss },
      ...[oswald500, plexSans400, plexSans500, plexMono400].map((href) => ({
        rel: 'preload',
        as: 'font',
        type: 'font/woff2',
        href,
        crossOrigin: 'anonymous' as const,
      })),
    ],
  }
}

/** The landing page whose path this is. */
export const landingPage = (path: SitePage['path']) => PAGES.find((page) => page.path === path)!

export function sitemapXml() {
  const urls = PAGES.map((page) => `  <url><loc>${SITE_ORIGIN}${page.path}</loc></url>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}
