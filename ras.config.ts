import {
  defineConfig,
  tanstackStart,
  betterAuth,
  sqlite,
  postgres,
  email,
  realtime,
  uploads,
  posthog,
  typescript,
  oxlint,
  oxfmt,
  vite,
  vitest,
  playwright,
} from 'ras-stack/config'

export default defineConfig({
  integrations: [tanstackStart, betterAuth, sqlite, postgres, email, realtime, uploads, posthog.react, posthog.server],
  tooling: [typescript.tanstack, oxlint.application, oxlint.tanstack, oxlint.domain, oxfmt, vite, vitest, playwright],
})
