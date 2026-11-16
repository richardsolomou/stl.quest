import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildEmailDelivery, resolveSmtpConfig, smtpConfigFromEnvironment, smtpDelivery, workspaceEmailDelivery } from './email'

const nodemailer = vi.hoisted(() => ({ createTransport: vi.fn(), sendMail: vi.fn(), verify: vi.fn() }))

vi.mock('nodemailer', () => ({ createTransport: nodemailer.createTransport }))

const config = { from: 'from@example.com', host: 'smtp.example.com', port: 587, secure: false }
const message = { to: 'to@example.com', subject: 'Hello', text: 'Body' }

beforeEach(() => {
  vi.clearAllMocks()
  nodemailer.createTransport.mockReturnValue({ sendMail: nodemailer.sendMail, verify: nodemailer.verify })
  nodemailer.sendMail.mockResolvedValue({})
  nodemailer.verify.mockResolvedValue(true)
})

describe('smtpConfigFromEnvironment', () => {
  it('is undefined when SMTP is not configured', () => {
    expect(smtpConfigFromEnvironment({})).toBeUndefined()
  })

  it('parses a complete authenticated configuration', () => {
    expect(
      smtpConfigFromEnvironment({
        SMTP_HOST: ' smtp.example.com ',
        SMTP_PORT: '465',
        SMTP_SECURE: 'TRUE',
        SMTP_USER: ' user ',
        SMTP_PASSWORD: 'secret',
        EMAIL_FROM: 'mail@example.com',
      }),
    ).toEqual({ from: 'mail@example.com', host: 'smtp.example.com', port: 465, secure: true, user: 'user', password: 'secret' })
  })

  it('defaults to port 587 without TLS from the start', () => {
    expect(smtpConfigFromEnvironment({ SMTP_HOST: 'smtp.example.com', EMAIL_FROM: 'mail@example.com' })).toEqual({
      from: 'mail@example.com',
      host: 'smtp.example.com',
      port: 587,
      secure: false,
    })
  })

  it('requires a sender with a host', () => {
    expect(() => smtpConfigFromEnvironment({ SMTP_HOST: 'smtp.example.com' })).toThrow('EMAIL_FROM is required')
  })

  it('requires a host with a sender', () => {
    expect(() => smtpConfigFromEnvironment({ EMAIL_FROM: 'mail@example.com' })).toThrow('SMTP_HOST is required')
  })

  it('rejects partial credentials', () => {
    expect(() => smtpConfigFromEnvironment({ SMTP_HOST: 'smtp.example.com', EMAIL_FROM: 'mail@example.com', SMTP_USER: 'user' })).toThrow(
      'SMTP_USER and SMTP_PASSWORD must be configured together',
    )
  })

  it('rejects an invalid port', () => {
    expect(() => smtpConfigFromEnvironment({ SMTP_HOST: 'smtp.example.com', EMAIL_FROM: 'mail@example.com', SMTP_PORT: '0' })).toThrow(
      'SMTP_PORT must be a valid TCP port',
    )
  })
})

describe('smtpDelivery', () => {
  it('passes inline attachments to the transport', async () => {
    const logo = { filename: 'logo.png', content: Buffer.from('png'), contentType: 'image/png', cid: 'logo' }
    await smtpDelivery(config).send({ ...message, html: '<img src="cid:logo">', attachments: [logo] })
    expect(nodemailer.sendMail).toHaveBeenCalledWith(expect.objectContaining({ attachments: [logo] }))
  })

  it('keeps the configured sender address under a per-message display name', async () => {
    await smtpDelivery({ ...config, from: 'Example <from@example.com>' }).send({ ...message, fromName: 'Print lab' })
    expect(nodemailer.sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: { name: 'Print lab', address: 'from@example.com' } }))
  })

  it('uses a bare configured address under a per-message display name', async () => {
    await smtpDelivery(config).send({ ...message, fromName: 'Print lab' })
    expect(nodemailer.sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: { name: 'Print lab', address: 'from@example.com' } }))
  })

  it('passes a reply-to address to the transport', async () => {
    await smtpDelivery(config).send({ ...message, replyTo: 'shop@example.com' })
    expect(nodemailer.sendMail).toHaveBeenCalledWith(expect.objectContaining({ replyTo: 'shop@example.com' }))
  })

  it('authenticates with the configured credentials', async () => {
    await smtpDelivery({ ...config, user: 'user', password: 'secret' }).send(message)
    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ auth: { user: 'user', pass: 'secret' } }))
  })

  it('refuses to send credentials over a connection without TLS', async () => {
    await smtpDelivery({ ...config, user: 'user', password: 'secret' }).send(message)
    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ requireTLS: true }))
  })

  it('allows an unauthenticated local server without TLS', async () => {
    await smtpDelivery(config).send(message)
    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ requireTLS: false }))
  })

  it('verifies TLS against the hostname when connecting to a resolved address', async () => {
    await smtpDelivery({ ...config, host: '203.0.113.10', servername: 'smtp.example.com' }).verify()
    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: '203.0.113.10', servername: 'smtp.example.com' }),
    )
  })

  it('bounds each wait on the server by the default timeout', async () => {
    await smtpDelivery(config).verify()
    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ connectionTimeout: 20_000, greetingTimeout: 20_000, socketTimeout: 20_000 }),
    )
  })

  it('fails a send that outlasts the timeout', async () => {
    nodemailer.sendMail.mockReturnValue(new Promise(() => undefined))
    await expect(smtpDelivery({ ...config, timeoutMs: 10 }).send(message)).rejects.toThrow('did not finish within 10 ms')
  })

  it('fails a verification that outlasts the timeout', async () => {
    nodemailer.verify.mockReturnValue(new Promise(() => undefined))
    await expect(smtpDelivery({ ...config, timeoutMs: 10 }).verify()).rejects.toThrow('did not finish within 10 ms')
  })

  it('throws the error the server returns', async () => {
    const error = new Error('550 mailbox unavailable')
    nodemailer.sendMail.mockRejectedValue(error)
    await expect(smtpDelivery(config).send(message)).rejects.toBe(error)
  })
})

describe('application SMTP configuration', () => {
  it('is optional', () => {
    expect(resolveSmtpConfig(undefined, {})).toBeUndefined()
    expect(buildEmailDelivery()).toBeUndefined()
  })

  it('validates environment configuration', () => {
    expect(() => resolveSmtpConfig(undefined, { SMTP_HOST: 'smtp.example.com' })).toThrow(/EMAIL_FROM/)
  })

  it('reads stored SMTP settings', () => {
    const smtp = { from: 'print@example.com', host: 'smtp.example.com', port: 587, secure: false, testedAt: 123 }
    expect(resolveSmtpConfig({ passwordEnabled: true, smtp }, {})).toEqual(smtp)
  })

  it('prefers the environment over stored settings', () => {
    const smtp = { from: 'print@example.com', host: 'stored.example.com', port: 587, secure: false }
    expect(resolveSmtpConfig({ passwordEnabled: true, smtp }, { SMTP_HOST: 'smtp.example.com', EMAIL_FROM: 'mail@example.com' })).toEqual({
      from: 'mail@example.com',
      host: 'smtp.example.com',
      port: 587,
      secure: false,
    })
  })
})

describe('workspace mail server', () => {
  const smtp = { from: 'shop@example.com', host: 'localhost', port: 587, secure: false }

  it('refuses a hosted workspace server on a private network', async () => {
    await expect(workspaceEmailDelivery(smtp, true).verify()).rejects.toThrow('public internet address')
  })

  it('refuses to send through a hosted workspace server on a private network', async () => {
    await expect(
      workspaceEmailDelivery({ ...smtp, host: '10.0.0.5' }, true).send({ to: 'a@example.com', subject: 's', text: 't' }),
    ).rejects.toThrow('public internet address')
  })
})
