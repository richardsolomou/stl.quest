import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DrizzleRepository } from '../src/db/repository'
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

  const repository = DrizzleRepository.open()
  const workspace = repository.listWorkspaces()[0]
  const requests = repository.scoped(workspace.id).listRequests()
  expect(
    requests
      .map(({ name, quantity, requestedPrintType }) => ({ name, quantity, requestedPrintType }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  ).toEqual([
    { name: 'Calibration cube', quantity: 1, requestedPrintType: 'resin' },
    { name: 'Replacement bracket', quantity: 2, requestedPrintType: 'filament' },
    { name: 'Tabletop miniatures', quantity: 4, requestedPrintType: 'resin' },
  ])
  expect(repository.database.query.user.findFirst({ where: (record, { eq }) => eq(record.email, PREVIEW_EMAIL) })).toBeTruthy()
  repository.close()
})
