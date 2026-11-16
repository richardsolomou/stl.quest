import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import type { Plugin } from 'vite'
import { defineConfig, loadEnv } from 'vite'
import packageJson from './package.json' with { type: 'json' }
import { postHogSourceMaps } from './scripts/posthogSourceMaps.ts'

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
  const sourceMaps = postHogSourceMaps({ ...loadEnv(mode, process.cwd(), ''), ...process.env })
  return {
    resolve: { tsconfigPaths: true },
    // Prebundle the upload client's CommonJS dependencies before serving them to the browser.
    optimizeDeps: { include: ['ras-stack > tus-js-client'] },
    server: {
      port: 3000,
      proxy: { '/connection': { target: 'http://127.0.0.1:8000', ws: true } },
    },
    define: { __APP_VERSION__: JSON.stringify(packageJson.version) },
    plugins: [
      devApiImages,
      tanstackStart(),
      nitro({
        routeRules: { '/api/**': { headers: { 'X-Robots-Tag': 'noindex, nofollow' } } },
      }),
      viteReact(),
      tailwindcss(),
      sourceMaps?.client,
    ],
    ...(sourceMaps ? { worker: { plugins: () => [sourceMaps.worker()] } } : {}),
  }
})
