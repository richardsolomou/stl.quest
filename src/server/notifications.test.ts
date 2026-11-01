import crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EmailMessage } from '../adapters/email'
import type { EmailBranding } from '../core/email'
import { encryptSetting } from './integrations'
import { deliveryTracker, emailNotifier, mailerTemplate, sendInviteEmail, workspaceEmailConfigured, workspaceMailer } from './notifications'

function notifier(send: () => Promise<void>, branding: EmailBranding = {}, relayed = false, ownServer = false) {
  const capture = vi.fn(async () => undefined)
  const email = { send: vi.fn(send), verify: async () => undefined }
  const deliveries = deliveryTracker()
  return {
    email,
    capture,
    deliveries,
    notifier: emailNotifier({
      mailer: async () => ({ delivery: email, relayed, ownServer }),
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
    await ready.printsReady({ id: 'requester', email: 'owner@example.com', name: 'Maya' }, [{ name: 'Bracket', count: 2 }])
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
    await ready.printsReady({ id: 'requester', email: 'owner@example.com', name: 'Maya' }, [{ name: 'Bracket', count: 1 }])
    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining('src="cid:workspace-logo"'),
        attachments: [{ filename: 'logo.png', content: Buffer.from('AAAA', 'base64'), contentType: 'image/png', cid: 'workspace-logo' }],
      }),
    )
  })

  it('sends from the workspace sender name with its reply-to address', async () => {
    const { email, notifier: ready } = notifier(async () => undefined, { sender: { name: 'Atelier', replyTo: 'shop@example.com' } })
    await ready.printsReady({ id: 'requester', email: 'owner@example.com', name: 'Maya' }, [{ name: 'Bracket', count: 1 }])
    expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ fromName: 'Atelier', replyTo: 'shop@example.com' }))
  })

  it('names STL Quest as the relay on the hosted service', async () => {
    const { email, notifier: ready } = notifier(async () => undefined, { sender: { name: 'Atelier' } }, true)
    await ready.printsReady({ id: 'requester', email: 'owner@example.com', name: 'Maya' }, [{ name: 'Bracket', count: 1 }])
    expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ fromName: 'Atelier via STL Quest' }))
  })

  it('uses the custom template when sending through the workspace mail server', async () => {
    const template = { subject: 'Ready, {{name}}', html: '<p>{{prints}}</p>' }
    const { email, notifier: ready } = notifier(async () => undefined, { templates: { 'print-ready': template } }, false, true)
    await ready.printsReady({ id: 'requester', email: 'owner@example.com', name: 'Maya' }, [{ name: 'Bracket', count: 1 }])
    expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ subject: 'Ready, Maya' }))
  })

  it('leaves the logo out when a custom template does not show it', async () => {
    const branding = {
      logo: { contentType: 'image/png' as const, data: 'AAAA' },
      templates: { 'print-ready': { subject: 'Ready', html: '<p>{{prints}}</p>' } },
    }
    const { email, notifier: ready } = notifier(async () => undefined, branding, false, true)
    await ready.printsReady({ id: 'requester', email: 'owner@example.com', name: 'Maya' }, [{ name: 'Bracket', count: 1 }])
    expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ attachments: undefined }))
  })

  it('ignores a custom template when the mail goes through the shared server', async () => {
    const template = { subject: 'Ready, {{name}}', html: '<p>{{prints}}</p>' }
    const { email, notifier: ready } = notifier(async () => undefined, { templates: { 'print-ready': template } }, true, false)
    await ready.printsReady({ id: 'requester', email: 'owner@example.com', name: 'Maya' }, [{ name: 'Bracket', count: 1 }])
    expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ subject: 'Your print is ready in Print lab' }))
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
    await ready.printsReady({ id: 'requester', email: 'owner@example.com', name: 'Maya' }, [{ name: 'Bracket', count: 1 }])
    expect(branding).not.toHaveBeenCalled()
  })

  it('keeps the server sender when the workspace has none', async () => {
    const { email, notifier: ready } = notifier(async () => undefined)
    await ready.printsReady({ id: 'requester', email: 'owner@example.com', name: 'Maya' }, [{ name: 'Bracket', count: 1 }])
    expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ fromName: undefined, replyTo: undefined }))
  })

  it('records an anonymous success event', async () => {
    const { capture, notifier: ready } = notifier(async () => undefined)
    await ready.printsReady({ id: 'requester', email: 'owner@example.com', name: 'Maya' }, [{ name: 'Bracket', count: 2 }])
    expect(capture).toHaveBeenCalledWith('requester', 'print_ready_email_sent', { request_count: 1, copy_count: 2 })
  })

  it('contains delivery failures without recording success', async () => {
    const { capture, notifier: ready } = notifier(async () => {
      throw new Error('smtp down')
    })
    await expect(
      ready.printsReady({ id: 'requester', email: 'owner@example.com', name: 'Maya' }, [{ name: 'Bracket', count: 1 }]),
    ).resolves.toBeUndefined()
    expect(capture).not.toHaveBeenCalled()
  })

  it('lets shutdown wait for an email that is still sending', async () => {
    const { capture, deliveries, notifier: ready } = notifier(async () => await new Promise((resolve) => setTimeout(resolve, 20)))
    void ready.printsReady({ id: 'requester', email: 'owner@example.com', name: 'Maya' }, [{ name: 'Bracket', count: 1 }])
    await deliveries.drain(1_000)
    expect(capture).toHaveBeenCalled()
  })

  it('stops waiting for a stalled email at the shutdown deadline', async () => {
    const { deliveries, notifier: ready } = notifier(async () => await new Promise(() => undefined))
    void ready.printsReady({ id: 'requester', email: 'owner@example.com', name: 'Maya' }, [{ name: 'Bracket', count: 1 }])
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
    await expect(
      emailNotifier({ ...options, mailer: async () => ({ delivery, relayed: false, ownServer: false }) }).canSend(),
    ).resolves.toBe(true)
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
    expect(await workspaceMailer(settings({}), deployment, true)).toEqual({ delivery: deployment, relayed: true, ownServer: false })
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

describe('mailer templates', () => {
  const delivery = { send: async () => undefined, verify: async () => undefined }
  const invite = { subject: 'Join {{workspace}}', html: '<p>{{link}}</p>' }

  it('uses the custom invitation template through the workspace mail server', () => {
    expect(mailerTemplate({ delivery, relayed: false, ownServer: true }, { templates: { invite } }, 'invite')).toBe(invite)
  })

  it('never sends a custom template through a shared mail server', () => {
    expect(mailerTemplate({ delivery, relayed: true, ownServer: false }, { templates: { invite } }, 'invite')).toBeUndefined()
  })

  it('never sends a custom template through a self-hosted deployment mail server', () => {
    expect(mailerTemplate({ delivery, relayed: false, ownServer: false }, { templates: { invite } }, 'invite')).toBeUndefined()
  })
})

describe('invitation emails', () => {
  const invite = { subject: 'Join {{workspace}}', html: '<p>{{link}}</p>' }
  const recipient = { to: 'maya@example.com', workspaceName: 'Lab', url: 'https://print.example/invite/t' }
  const logo = { contentType: 'image/png' as const, data: 'AAAA' }
  const sent = async (ownServer: boolean, branding: EmailBranding = { templates: { invite } }) => {
    const send = vi.fn(async (_message: EmailMessage) => undefined)
    await sendInviteEmail({ delivery: { send, verify: async () => undefined }, relayed: false, ownServer }, branding, recipient)
    return send.mock.calls[0][0]
  }

  it('uses the custom template through the workspace mail server', async () => {
    expect((await sent(true)).subject).toBe('Join Lab')
  })

  it('keeps the standard invitation through a deployment mail server', async () => {
    expect((await sent(false)).subject).toBe('You are invited to Lab on STL Quest')
  })

  it('attaches the logo a custom template shows', async () => {
    const shown = { subject: 'Join', html: '<p>{{logo}}</p>' }
    expect((await sent(true, { logo, templates: { invite: shown } })).attachments).toHaveLength(1)
  })

  it('leaves the logo out when a custom template does not show it', async () => {
    expect((await sent(true, { logo, templates: { invite } })).attachments).toBeUndefined()
  })
})
