import { describe, expect, it } from 'vitest'
import { buildEmailDelivery, resolveSmtpConfig, workspaceEmailDelivery } from './email'

describe('SMTP configuration', () => {
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
})

describe('workspace mail server', () => {
  const smtp = { from: 'shop@example.com', host: 'localhost', port: 587, secure: false }

  it('refuses a hosted workspace server on a private network', async () => {
    await expect(workspaceEmailDelivery(smtp, true).verify()).rejects.toThrow('private network')
  })

  it('refuses to send through a hosted workspace server on a private network', async () => {
    await expect(
      workspaceEmailDelivery({ ...smtp, host: '10.0.0.5' }, true).send({ to: 'a@example.com', subject: 's', text: 't' }),
    ).rejects.toThrow('private network')
  })
})
