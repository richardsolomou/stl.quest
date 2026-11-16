import type { NitroApp } from 'nitro/types'
import { expect, it, vi } from 'vitest'
import shutdown from './shutdown'

const { closeApp } = vi.hoisted(() => ({ closeApp: vi.fn(async () => undefined) }))
vi.mock('./app', () => ({ closeApp }))

function closeHooks() {
  const hooks: Array<() => unknown> = []
  shutdown({ hooks: { hook: (_name: string, hook: () => unknown) => hooks.push(hook) } } as unknown as NitroApp & {
    hooks: NonNullable<NitroApp['hooks']>
  })
  return hooks
}

it('closes the app when Nitro closes', async () => {
  await Promise.all(closeHooks().map((hook) => hook()))
  expect(closeApp).toHaveBeenCalledOnce()
})
