import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { DrizzleRepository } from '../src/db/repository'
import { user } from '../src/db/schema'
import { createAuth } from '../src/server/auth'
import { PREVIEW_EMAIL, seedPreview } from './seedPreview'

let root: string | undefined

afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true })
  delete process.env.DATA_DIR
  delete process.env.PRINTS_DIR
})

it('creates an idempotent populated preview snapshot', async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'stlquest-preview-seed-'))
  process.env.DATA_DIR = path.join(root, 'data')
  process.env.PRINTS_DIR = path.join(root, 'prints')

  await seedPreview()
  await seedPreview()

  const repository = await DrizzleRepository.open()
  const workspace = (await repository.listWorkspaces())[0]
  const requests = await (await repository.scoped(workspace.id)).listRequests()
  expect(
    requests
      .map(({ name, quantity, requestedPrintType }) => ({ name, quantity, requestedPrintType }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  ).toEqual([
    { name: 'Calibration cube', quantity: 1, requestedPrintType: 'resin' },
    { name: 'Replacement bracket', quantity: 2, requestedPrintType: 'filament' },
    { name: 'Tabletop miniatures', quantity: 4, requestedPrintType: 'resin' },
  ])
  // The preview account has to reach the deployment-wide admin surfaces, not just its own workspace.
  const owner = await repository.database.select({ role: user.role }).from(user).where(eq(user.email, PREVIEW_EMAIL)).get()
  expect(owner).toMatchObject({ role: 'super_admin' })
  await repository.close()
})

it('promotes the preview account even when it is not the first user', async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'stlquest-stale-seed-'))
  process.env.DATA_DIR = path.join(root, 'data')
  process.env.PRINTS_DIR = path.join(root, 'prints')
  const first = await DrizzleRepository.open()
  const auth = createAuth(first.database, 'secret-secret-secret', {
    baseURL: 'http://preview.local',
    trustedOrigins: ['http://preview.local'],
  })
  await auth.api.signUpEmail({ body: { email: 'someone@example.com', password: 'password1234', name: 'Someone' } })
  await first.close()

  await seedPreview()

  const repository = await DrizzleRepository.open()
  const owner = await repository.database.select({ role: user.role }).from(user).where(eq(user.email, PREVIEW_EMAIL)).get()
  await repository.close()
  expect(owner).toMatchObject({ role: 'super_admin' })
})
