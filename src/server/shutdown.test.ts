import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { NitroApp } from 'nitro/types'
import { afterEach, expect, it, vi } from 'vitest'
import { app, resetApp } from './app'
import shutdown from './shutdown'

function closeHooks() {
  const hooks: Array<() => unknown> = []
  shutdown({ hooks: { hook: (_name: string, hook: () => unknown) => hooks.push(hook) } } as unknown as NitroApp & {
    hooks: NonNullable<NitroApp['hooks']>
  })
  return hooks
}

let temporary: string | undefined

afterEach(async () => {
  await resetApp()
  vi.unstubAllEnvs()
  if (temporary) await fs.promises.rm(temporary, { recursive: true, force: true })
})

it('closes the app when Nitro closes', async () => {
  temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-shutdown-'))
  vi.stubEnv('DATA_DIR', temporary)
  const close = vi.spyOn(await app(), 'close')
  await Promise.all(closeHooks().map((hook) => hook()))
  expect(close).toHaveBeenCalledOnce()
})

it('does nothing when no app is running', async () => {
  await expect(Promise.all(closeHooks().map((hook) => hook()))).resolves.toBeDefined()
})
