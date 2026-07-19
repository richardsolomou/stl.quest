import type { Plugin } from 'vite'
import { defineConfig } from 'vite'
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

export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: { port: 3000 },
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
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://t.ras.sh; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://t.ras.sh https://www.gravatar.com https://cdn.discordapp.com https://*.googleusercontent.com; font-src 'self' data:; connect-src 'self' https://t.ras.sh; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
            'Referrer-Policy': 'strict-origin-when-cross-origin',
            'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
          },
        },
      },
    }),
    viteReact(),
  ],
})
