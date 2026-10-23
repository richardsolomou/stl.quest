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
  tailwind,
  nitro,
  vite,
  vitest,
  playwright,
} from 'ras-stack/config'

export default defineConfig({
  integrations: [tanstackStart, betterAuth, sqlite, postgres, email, realtime, uploads, posthog.react, posthog.server],
  tooling: [typescript, oxlint.domain, oxfmt, tailwind.animations, nitro, posthog.build, vite, vitest, playwright],
})
