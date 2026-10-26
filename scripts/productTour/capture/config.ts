import type { Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const captureDirectory = fileURLToPath(new URL('../../../.capture/', import.meta.url))

export const config = {
  baseUrl: process.env.BASE ?? 'http://localhost:3001',
  email: process.env.DEMO_EMAIL ?? 'richard@stl.quest',
  password: process.env.DEMO_PASSWORD ?? 'demo-demo-demo',
  outputDirectory: captureDirectory,
  workDirectory: path.join(captureDirectory, '.work'),
}

export const scenes = {
  landing: { width: 2560, height: 1440, scale: '1920:1080', speed: 1.15, orbitSpeed: 2.4, trim: 3.4 },
  gif: { width: 1728, height: 1080, scale: '1000:-1', speed: 1.2, trim: 3.2 },
} as const

export type SceneName = keyof typeof scenes

export function isSceneName(value: string | undefined): value is SceneName {
  return value !== undefined && value in scenes
}

export async function signIn(page: Page, settle = 4_000) {
  await page.goto(config.baseUrl, { waitUntil: 'networkidle' })
  await page.getByLabel(/email/i).first().fill(config.email)
  await page
    .getByLabel(/password/i)
    .first()
    .fill(config.password)
  await page
    .getByRole('button', { name: /sign in/i })
    .first()
    .click()
  await page.waitForTimeout(settle)
}
