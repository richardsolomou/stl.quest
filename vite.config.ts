import type { Plugin } from 'vite'
import { defineConfig, loadEnv } from 'vite'
import path from 'node:path'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { postHogEnvironment } from 'ras-stack/posthog'
import { postHogIngestProxy } from 'ras-stack/posthog/proxy'
import packageJson from './package.json' with { type: 'json' }
import { POSTHOG_INGEST_PATH } from './src/posthog.js'

// Dev-only: the dev server skips SSR handling for requests with
// Sec-Fetch-Dest: image, so <img> tags pointing at /api/* 404. Dropping the
// header for API paths routes them like any other request. Production serves
// everything through one handler and does not need this.
const devApiImages: Plugin = {
  name: 'stlquest-dev-api-images',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url?.startsWith('/api/') && req.headers['sec-fetch-dest'] === 'image') delete req.headers['sec-fetch-dest']
      next()
    })
  },
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const posthog = postHogEnvironment({ projectToken: env.VITE_POSTHOG_PROJECT_TOKEN, host: env.VITE_POSTHOG_HOST })
  const posthogProxy = posthog ? postHogIngestProxy(posthog, { path: POSTHOG_INGEST_PATH }) : undefined

  return {
    resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
    server: {
      port: 3000,
      proxy: {
        '/connection': { target: 'http://127.0.0.1:8000', ws: true },
        ...posthogProxy?.vite,
      },
    },
    define: { __APP_VERSION__: JSON.stringify(packageJson.version) },
    plugins: [
      devApiImages,
      tanstackStart(),
      nitro({
        routeRules: {
          ...posthogProxy?.nitro,
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
        },
      }),
      viteReact(),
      tailwindcss(),
    ],
  }
})
