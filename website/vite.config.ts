import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig, type Plugin, type ViteDevServer } from 'vite'
import packageJson from '../package.json' with { type: 'json' }

const rootPlaceholder = '<div id="root"></div>'

/**
 * `font-display: optional` (see styles.css) only uses a face that is ready almost immediately, so
 * these have to be requested with the stylesheet rather than discovered from it. Every face used
 * above the fold is preloaded; a face that loses that race falls back for the whole page load.
 */
const fontsAboveTheFold = [
  'oswald-latin-500-normal',
  'ibm-plex-sans-latin-400-normal',
  'ibm-plex-sans-latin-500-normal',
  'ibm-plex-mono-latin-400-normal',
]

function preloadFonts(): Plugin {
  let base = '/'
  return {
    name: 'preload-fonts',
    apply: 'build',
    configResolved(config) {
      base = config.base
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        return Object.keys(ctx.bundle ?? {})
          .filter((file) => file.endsWith('.woff2') && fontsAboveTheFold.some((name) => path.basename(file).startsWith(name)))
          .map((file) => ({
            tag: 'link',
            attrs: { rel: 'preload', as: 'font', type: 'font/woff2', crossorigin: true, href: base + file },
            injectTo: 'head' as const,
          }))
      },
    },
  }
}

/** The build prerenders via scripts/prerender.ts; this keeps dev on the same markup so that hydration mismatches surface here first. */
function prerenderInDev(): Plugin {
  let server: ViteDevServer
  return {
    name: 'prerender-in-dev',
    apply: 'serve',
    configureServer(devServer) {
      server = devServer
    },
    transformIndexHtml: {
      order: 'post',
      async handler(html, ctx) {
        const site = (await server.ssrLoadModule('/src/entry-server.tsx')) as typeof import('./src/entry-server')
        const pathname = ctx.originalUrl ?? '/'
        return html
          .replace('<!--page-head-->', site.pageHead(pathname))
          .replace(rootPlaceholder, `<div id="root">${site.render(pathname)}</div>`)
      },
    },
  }
}

// Run from the repository root with `--config website/vite.config.ts`; the site shares the application's components and core.
export default defineConfig({
  root: import.meta.dirname,
  envDir: import.meta.dirname,
  resolve: { alias: { '@': path.resolve(import.meta.dirname, '../src') } },
  define: { __APP_VERSION__: JSON.stringify(packageJson.version) },
  plugins: [tailwindcss(), react(), preloadFonts(), prerenderInDev()],
})
