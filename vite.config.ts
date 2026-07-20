import type { Plugin } from 'vite'
import { defineConfig, loadEnv } from 'vite'
import path from 'node:path'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import packageJson from './package.json'

// Dev-only: the dev server skips SSR handling for requests with
// Sec-Fetch-Dest: image, so <img> tags pointing at /api/* 404. Dropping the
// header for API paths routes them like any other request. Production serves
// everything through one handler and does not need this.
const devApiImages: Plugin = {
  name: 'printhub-dev-api-images',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url?.startsWith('/api/') && req.headers['sec-fetch-dest'] === 'image') delete req.headers['sec-fetch-dest']
      next()
    })
  },
}

// Static PostHog US-region asset CDN; only the ingestion host is operator-configurable.
const POSTHOG_ASSETS_HOST = 'https://us-assets.i.posthog.com'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const posthogHost = env.VITE_POSTHOG_HOST

  return {
    resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
    server: {
      port: 3000,
      proxy: posthogHost
        ? {
            '/ingest/static': {
              target: POSTHOG_ASSETS_HOST,
              changeOrigin: true,
              rewrite: (requestPath) => requestPath.replace(/^\/ingest/, ''),
            },
            '/ingest/array': {
              target: POSTHOG_ASSETS_HOST,
              changeOrigin: true,
              rewrite: (requestPath) => requestPath.replace(/^\/ingest/, ''),
            },
            '/ingest': { target: posthogHost, changeOrigin: true, rewrite: (requestPath) => requestPath.replace(/^\/ingest/, '') },
          }
        : undefined,
    },
    define: { __APP_VERSION__: JSON.stringify(packageJson.version) },
    plugins: [
      devApiImages,
      tailwindcss(),
      tanstackStart(),
      nitro({
        routeRules: {
          '/**': {
            headers: {
              'Content-Security-Policy':
                "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://www.gravatar.com https://cdn.discordapp.com https://*.googleusercontent.com; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
              'Referrer-Policy': 'strict-origin-when-cross-origin',
              'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
              'X-Content-Type-Options': 'nosniff',
              'X-Frame-Options': 'DENY',
            },
          },
          ...(posthogHost && {
            '/ingest/static/**': { proxy: `${POSTHOG_ASSETS_HOST}/static/**` },
            '/ingest/array/**': { proxy: `${POSTHOG_ASSETS_HOST}/array/**` },
            '/ingest/**': { proxy: `${posthogHost}/**` },
          }),
        },
      }),
      viteReact(),
    ],
  }
})
