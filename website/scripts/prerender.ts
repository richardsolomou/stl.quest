// Renders the site to static markup and inlines it into the built index.html, so the first paint
// carries content instead of waiting for the bundle to parse. Run after both Vite builds.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

type Site = typeof import('../src/entry-server')

const dist = resolve(import.meta.dirname, '../dist')
const serverDir = resolve(dist, 'server')
const indexPath = resolve(dist, 'index.html')

const site = (await import(pathToFileURL(resolve(serverDir, 'entry-server.js')).href)) as Site
const template = readFileSync(indexPath, 'utf8')

for (const placeholder of ['<!--page-head-->', '<div id="root"></div>']) {
  if (!template.includes(placeholder))
    throw new Error(`Expected ${placeholder} in dist/index.html; the prerendered page has nowhere to go.`)
}

for (const page of site.PAGES) {
  const html = template
    .replace('<!--page-head-->', site.pageHead(page.path))
    .replace('<div id="root"></div>', `<div id="root">${site.render(page.path)}</div>`)
  const outputPath = page.path === '/' ? indexPath : resolve(dist, page.path.slice(1), 'index.html')
  mkdirSync(resolve(outputPath, '..'), { recursive: true })
  writeFileSync(outputPath, html)
}

writeFileSync(resolve(dist, 'sitemap.xml'), site.sitemapXml())
writeFileSync(resolve(dist, 'llms.txt'), site.llmsText())
rmSync(serverDir, { recursive: true, force: true })

console.log(`prerendered ${site.PAGES.length} pages`)
