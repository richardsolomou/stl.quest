import type { Plugin } from 'vite'
import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
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
  server: { port: 3000 },
  define: { __APP_VERSION__: JSON.stringify(packageJson.version) },
  plugins: [devApiImages, tanstackStart(), nitro(), viteReact()],
})
