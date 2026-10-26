import { createFileRoute } from '@tanstack/react-router'
import { SITE_ORIGIN } from '../client/landing/site'
import { hostedFile } from '../server/landingFiles'

export const Route = createFileRoute('/robots.txt')({
  server: {
    handlers: {
      GET: () => hostedFile(() => `User-agent: *\nAllow: /\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`, 'text/plain; charset=utf-8'),
    },
  },
})
