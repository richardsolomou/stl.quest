import { describe, expect, it } from 'vitest'
import { pageAt, pageHead, sitemapXml } from './discovery'

const structuredData = (head: string) => JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/.exec(head)?.[1] ?? 'null')

describe('pageAt', () => {
  it('finds a page requested without its trailing slash', () => {
    expect(pageAt('/privacy')?.path).toBe('/privacy/')
  })

  it('ignores the query string', () => {
    expect(pageAt('/terms?ref=footer')?.path).toBe('/terms/')
  })

  it('finds nothing for an unknown path', () => {
    expect(pageAt('/pricing')).toBeUndefined()
  })
})

describe('pageHead', () => {
  it('gives each page its own canonical address', () => {
    expect(pageHead('/privacy/')).toContain('<link rel="canonical" href="https://stl.quest/privacy/" />')
  })

  it('gives each page its own social address', () => {
    expect(pageHead('/terms/')).toContain('<meta property="og:url" content="https://stl.quest/terms/" />')
  })

  it('describes a legal page with its own title rather than the home pitch', () => {
    expect(pageHead('/terms/')).toContain('<meta property="og:title" content="Terms of Service — STL Quest" />')
  })

  it('describes the home page as a website and an application', () => {
    expect(structuredData(pageHead('/'))['@graph'].map((node: { '@type': string }) => node['@type'])).toEqual([
      'WebSite',
      'SoftwareApplication',
    ])
  })

  it('keeps structured data off the legal pages', () => {
    expect(structuredData(pageHead('/privacy/'))).toBeNull()
  })
})

describe('sitemapXml', () => {
  it('lists every page at its canonical address', () => {
    expect([...sitemapXml().matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1])).toEqual([
      'https://stl.quest/',
      'https://stl.quest/terms/',
      'https://stl.quest/privacy/',
    ])
  })
})
