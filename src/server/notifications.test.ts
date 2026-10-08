import { describe, expect, it, vi } from 'vitest'
import { deliveryTracker, emailNotifier } from './notifications'

function notifier(send: () => Promise<void>) {
  const capture = vi.fn(async () => undefined)
  const email = { send: vi.fn(send), verify: async () => undefined }
  const deliveries = deliveryTracker()
  return {
    email,
    capture,
    deliveries,
    notifier: emailNotifier({
      email,
      telemetry: { capture, exception: async () => undefined },
      workspaceId: 'workspace',
      workspaceName: async () => 'Print lab',
      appUrl: () => 'https://print.example',
      deliveries,
    }),
  }
}

describe('print-ready email notifier', () => {
  it('emails the requester a link back to STL Quest', async () => {
    const { email, notifier: ready } = notifier(async () => undefined)
    await ready.printsReady({ id: 'requester', email: 'owner@example.com' }, [{ name: 'Bracket', count: 2 }])
    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'owner@example.com',
        subject: 'Your prints are ready in Print lab',
        text: expect.stringContaining('https://print.example'),
      }),
    )
  })

  it('records an anonymous success event', async () => {
    const { capture, notifier: ready } = notifier(async () => undefined)
    await ready.printsReady({ id: 'requester', email: 'owner@example.com' }, [{ name: 'Bracket', count: 2 }])
    expect(capture).toHaveBeenCalledWith('requester', 'print_ready_email_sent', { request_count: 1, copy_count: 2 })
  })

  it('contains delivery failures without recording success', async () => {
    const { capture, notifier: ready } = notifier(async () => {
      throw new Error('smtp down')
    })
    await expect(
      ready.printsReady({ id: 'requester', email: 'owner@example.com' }, [{ name: 'Bracket', count: 1 }]),
    ).resolves.toBeUndefined()
    expect(capture).not.toHaveBeenCalled()
  })

  it('lets shutdown wait for an email that is still sending', async () => {
    const { capture, deliveries, notifier: ready } = notifier(async () => await new Promise((resolve) => setTimeout(resolve, 20)))
    void ready.printsReady({ id: 'requester', email: 'owner@example.com' }, [{ name: 'Bracket', count: 1 }])
    await deliveries.drain(1_000)
    expect(capture).toHaveBeenCalled()
  })

  it('stops waiting for a stalled email at the shutdown deadline', async () => {
    const { deliveries, notifier: ready } = notifier(async () => await new Promise(() => undefined))
    void ready.printsReady({ id: 'requester', email: 'owner@example.com' }, [{ name: 'Bracket', count: 1 }])
    await expect(deliveries.drain(10)).resolves.toBe(false)
  })
})
