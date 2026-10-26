import { createFileRoute } from '@tanstack/react-router'
import { sitemapXml } from '../client/landing/discovery'
import { hostedFile } from '../server/landingFiles'

export const Route = createFileRoute('/sitemap.xml')({
  server: { handlers: { GET: () => hostedFile(sitemapXml, 'application/xml; charset=utf-8') } },
})
