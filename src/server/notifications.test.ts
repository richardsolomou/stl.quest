import crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EmailBranding } from '../core/email'
import { encryptSetting } from './integrations'
import { deliveryTracker, emailNotifier, workspaceEmailConfigured, workspaceMailer } from './notifications'

function notifier(send: () => Promise<void>, branding: EmailBranding = {}, relayed = false) {
  const capture = vi.fn(async () => undefined)
  const email = { send: vi.fn(send), verify: async () => undefined }
  const deliveries = deliveryTracker()
  return {
    email,
    capture,
    deliveries,
    notifier: emailNotifier({
      mailer: async () => ({ delivery: email, relayed }),
      telemetry: { capture, exception: async () => undefined },
      workspaceId: 'workspace',
      workspaceName: async () => 'Print lab',
      branding: async () => branding,
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

  it('embeds the workspace logo inline', async () => {
    const { email, notifier: ready } = notifier(async () => undefined, { logo: { contentType: 'image/png', data: 'AAAA' } })
    await ready.printsReady({ id: 'requester', email: 'owner@example.com' }, [{ name: 'Bracket', count: 1 }])
    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining('src="cid:workspace-logo"'),
        attachments: [{ filename: 'logo.png', content: Buffer.from('AAAA', 'base64'), contentType: 'image/png', cid: 'workspace-logo' }],
      }),
    )
  })

  it('sends from the workspace sender name with its reply-to address', async () => {
    const { email, notifier: ready } = notifier(async () => undefined, { sender: { name: 'Atelier', replyTo: 'shop@example.com' } })
    await ready.printsReady({ id: 'requester', email: 'owner@example.com' }, [{ name: 'Bracket', count: 1 }])
    expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ fromName: 'Atelier', replyTo: 'shop@example.com' }))
  })

  it('names STL Quest as the relay on the hosted service', async () => {
    const { email, notifier: ready } = notifier(async () => undefined, { sender: { name: 'Atelier' } }, true)
    await ready.printsReady({ id: 'requester', email: 'owner@example.com' }, [{ name: 'Bracket', count: 1 }])
    expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ fromName: 'Atelier via STL Quest' }))
  })

  it('skips the email when the workspace cannot send any', async () => {
    const branding = vi.fn(async () => ({}))
    const ready = emailNotifier({
      mailer: async () => undefined,
      telemetry: { capture: async () => undefined, exception: async () => undefined },
      workspaceId: 'workspace',
      workspaceName: async () => 'Print lab',
      branding,
      appUrl: () => undefined,
      deliveries: deliveryTracker(),
    })
    await ready.printsReady({ id: 'requester', email: 'owner@example.com' }, [{ name: 'Bracket', count: 1 }])
    expect(branding).not.toHaveBeenCalled()
  })

  it('keeps the server sender when the workspace has none', async () => {
    const { email, notifier: ready } = notifier(async () => undefined)
    await ready.printsReady({ id: 'requester', email: 'owner@example.com' }, [{ name: 'Bracket', count: 1 }])
    expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ fromName: undefined, replyTo: undefined }))
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

describe('print-ready sending availability', () => {
  const options = {
    telemetry: { capture: async () => undefined, exception: async () => undefined },
    workspaceId: 'workspace',
    workspaceName: async () => 'Print lab',
    branding: async () => ({}),
    appUrl: () => undefined,
    deliveries: deliveryTracker(),
  }

  it('can send with a mailer', async () => {
    const delivery = { send: async () => undefined, verify: async () => undefined }
    await expect(emailNotifier({ ...options, mailer: async () => ({ delivery, relayed: false }) }).canSend()).resolves.toBe(true)
  })

  it('cannot send without a mailer', async () => {
    await expect(emailNotifier({ ...options, mailer: async () => undefined }).canSend()).resolves.toBe(false)
  })
})

describe('workspace mailer', () => {
  beforeEach(() => vi.stubEnv('INTEGRATIONS_ENCRYPTION_KEY', crypto.randomBytes(32).toString('base64url')))
  afterEach(() => vi.unstubAllEnvs())
  const deployment = { send: async () => undefined, verify: async () => undefined }
  const smtp = { from: 'shop@example.com', host: 'smtp.example.com', port: 587, secure: false }
  const settings = (stored: Record<string, unknown>) => ({ getSetting: async <T>(key: string) => stored[key] as T | undefined })

  it('relays through the hosted service when the workspace has no mail server', async () => {
    expect(await workspaceMailer(settings({}), deployment, true)).toEqual({ delivery: deployment, relayed: true })
  })

  it('sends directly from a self-hosted server', async () => {
    expect((await workspaceMailer(settings({}), deployment, false))?.relayed).toBe(false)
  })

  it('uses the workspace mail server instead of the deployment', async () => {
    const mailer = await workspaceMailer(settings({ emailSmtpEncrypted: encryptSetting(smtp) }), deployment, true)
    expect(mailer).toMatchObject({ relayed: false })
  })

  it('does not reuse the deployment delivery for a workspace mail server', async () => {
    const mailer = await workspaceMailer(settings({ emailSmtpEncrypted: encryptSetting(smtp) }), deployment, true)
    expect(mailer?.delivery).not.toBe(deployment)
  })

  it('keeps a hosted workspace mail server off the hosting network', async () => {
    const mailer = await workspaceMailer(settings({ emailSmtpEncrypted: encryptSetting({ ...smtp, host: 'localhost' }) }), deployment, true)
    await expect(mailer!.delivery.verify()).rejects.toThrow('private network')
  })

  it('has nothing to send with when neither is configured', async () => {
    expect(await workspaceMailer(settings({}), undefined, true)).toBeUndefined()
  })
})

describe('workspace email availability', () => {
  const settings = (stored: Record<string, unknown>) => ({ getSetting: async <T>(key: string) => stored[key] as T | undefined })

  it('is available when the deployment can send', async () => {
    expect(await workspaceEmailConfigured(true, settings({}))).toBe(true)
  })

  it('is available when the workspace brings its own mail server', async () => {
    expect(await workspaceEmailConfigured(false, settings({ emailSmtpEncrypted: { version: 1 } }))).toBe(true)
  })

  it('is unavailable when neither can send', async () => {
    expect(await workspaceEmailConfigured(false, settings({}))).toBe(false)
  })
})
