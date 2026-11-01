import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createSmtpDelivery: vi.fn(() => ({ send: vi.fn(async () => undefined), verify: vi.fn(async () => undefined) })),
  resolvePublicAddress: vi.fn(async () => '198.51.100.7'),
}))
vi.mock('ras-stack/email', () => ({ createSmtpDelivery: mocks.createSmtpDelivery }))
vi.mock('./outbound', () => ({ resolvePublicAddress: mocks.resolvePublicAddress }))

import { workspaceEmailDelivery } from './email'

const smtp = { from: 'shop@example.com', host: 'smtp.example.com', port: 587, secure: false }

beforeEach(() => vi.clearAllMocks())

describe('hosted workspace mail server', () => {
  it('connects to the checked address while verifying TLS for the hostname', async () => {
    await workspaceEmailDelivery(smtp, true).verify()
    expect(mocks.createSmtpDelivery).toHaveBeenCalledWith(expect.objectContaining({ host: '198.51.100.7', servername: 'smtp.example.com' }))
  })

  it('bounds each exchange with the hosted timeout', async () => {
    await workspaceEmailDelivery(smtp, true).verify()
    expect(mocks.createSmtpDelivery).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 20_000 }))
  })

  it('checks the address again for every message', async () => {
    const delivery = workspaceEmailDelivery(smtp, true)
    await delivery.send({ to: 'a@example.com', subject: 's', text: 't' })
    await delivery.send({ to: 'b@example.com', subject: 's', text: 't' })
    expect(mocks.resolvePublicAddress).toHaveBeenCalledTimes(2)
  })

  it('leaves a self-hosted workspace server unresolved', () => {
    workspaceEmailDelivery(smtp, false)
    expect(mocks.createSmtpDelivery).toHaveBeenCalledWith(smtp)
  })
})
