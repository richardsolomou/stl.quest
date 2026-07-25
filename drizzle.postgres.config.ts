import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema-postgres/index.ts',
  out: './drizzle-postgres',
})
