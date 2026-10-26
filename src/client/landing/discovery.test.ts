import { describe, expect, it } from 'vitest'
import { landingHead, landingPage, sitemapXml } from './discovery'

const head = (path: string) => landingHead(landingPage(path))
const meta = (path: string, key: string) =>
  head(path).meta.find((tag) => 'name' in tag && tag.name === key) ??
  head(path).meta.find((tag) => 'property' in tag && tag.property === key)
const structuredData = (path: string) => head(path).meta.find((tag) => 'script:ld+json' in tag)

describe('landingHead', () => {
  it('gives each page its own canonical address', () => {
    expect(head('/privacy').links.find((link) => link.rel === 'canonical')?.href).toBe('https://stl.quest/privacy')
  })

  it('gives each page its own social address', () => {
    expect(meta('/terms', 'og:url')?.content).toBe('https://stl.quest/terms')
  })

  it('describes a legal page with its own title rather than the home pitch', () => {
    expect(meta('/terms', 'og:title')?.content).toBe('Terms of Service — STL Quest')
  })

  it('lets search engines index the page the application otherwise hides', () => {
    expect(meta('/', 'robots')?.content).toBe('index, follow')
  })

  it('describes the home page as a website and an application', () => {
    const data = structuredData('/') as { 'script:ld+json': { '@graph': { '@type': string }[] } } | undefined
    expect(data?.['script:ld+json']['@graph'].map((node) => node['@type'])).toEqual(['WebSite', 'SoftwareApplication'])
  })

  it('keeps structured data off the legal pages', () => {
    expect(structuredData('/privacy')).toBeUndefined()
  })
})

describe('sitemapXml', () => {
  it('lists every page at its canonical address', () => {
    expect([...sitemapXml().matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1])).toEqual([
      'https://stl.quest/',
      'https://stl.quest/terms',
      'https://stl.quest/privacy',
    ])
  })
})
