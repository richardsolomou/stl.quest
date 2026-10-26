import { renderToString } from 'react-dom/server'
import { App } from './App'

export { pageAt, pageHead, sitemapXml } from './discovery'
export { llmsText } from './llms'
export { PAGES } from './site'

export function render(pathname = '/') {
  return renderToString(<App pathname={pathname} />)
}
