import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import packageJson from './package.json'

export default defineConfig({
  server: {
    port: 3000,
    // Dev-only: the dev server's asset handling intercepts extension-suffixed
    // GETs before the /ingest/$ route can proxy them. Production serves all
    // of /ingest through that route.
    proxy: {
      '/ingest/static': {
        target: 'https://us-assets.i.posthog.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ingest/, ''),
      },
      '/ingest/array': {
        target: 'https://us-assets.i.posthog.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ingest/, ''),
      },
    },
  },
  define: { __APP_VERSION__: JSON.stringify(packageJson.version) },
  plugins: [tanstackStart(), nitro(), viteReact()],
})
