import nodemailer from 'nodemailer'
import type { IntegrationConfig, SmtpEmailConfig } from '../core/auth'
import { environmentFlag } from './environment'

export type EmailMessage = { to: string; subject: string; text: string; html?: string }

export interface EmailDelivery {
  send(message: EmailMessage): Promise<void>
  verify(): Promise<void>
}

class SmtpEmailDelivery implements EmailDelivery {
  private readonly transporter

  constructor(private readonly config: SmtpEmailConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user ? { user: config.user, pass: config.password } : undefined,
    })
  }

  async send(message: EmailMessage) {
    await this.transporter.sendMail({ from: this.config.from, ...message })
  }

  async verify() {
    await this.transporter.verify()
  }
}

export function resolveSmtpConfig(stored?: IntegrationConfig, environment: NodeJS.ProcessEnv = process.env): SmtpEmailConfig | undefined {
  const configured = environment.SMTP_HOST?.trim()
  if (!configured) return stored?.smtp
  const from = environment.EMAIL_FROM?.trim()
  const host = environment.SMTP_HOST?.trim()
  if (!from) throw new Error('EMAIL_FROM is required for SMTP email')
  if (!host) throw new Error('SMTP_HOST is required for SMTP email')
  const port = Number(environment.SMTP_PORT ?? 587)
  const user = environment.SMTP_USER?.trim()
  const password = environment.SMTP_PASSWORD
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('SMTP_PORT must be a valid TCP port')
  if ((user && !password) || (!user && password)) throw new Error('SMTP_USER and SMTP_PASSWORD must be configured together')
  return { from, host, port, secure: environmentFlag(environment.SMTP_SECURE), user, password }
}

export function buildEmailDelivery(config?: SmtpEmailConfig): EmailDelivery | undefined {
  return config ? new SmtpEmailDelivery(config) : undefined
}
