import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import packageJson from './package.json'

export default defineConfig({
  server: { port: 3000 },
  define: { __APP_VERSION__: JSON.stringify(packageJson.version) },
  plugins: [tanstackStart(), nitro(), viteReact()],
})
