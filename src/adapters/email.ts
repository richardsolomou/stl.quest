import { createSmtpDelivery, type EmailAttachment, type EmailDelivery, type EmailMessage } from 'ras-stack/email'
import type { IntegrationConfig, SmtpEmailConfig } from '../core/auth'
import { EMAIL_LOGO_CID, type EmailLogo } from '../core/email'
import { environmentFlag } from './environment'

export type { EmailDelivery, EmailMessage }

/** Embeds the workspace logo inline so it shows even when the server is unreachable from the recipient's mail client. */
export function emailLogoParts(logo?: EmailLogo): { logoSrc?: string; attachments?: EmailAttachment[] } {
  if (!logo) return {}
  const extension = logo.contentType.slice('image/'.length)
  return {
    logoSrc: `cid:${EMAIL_LOGO_CID}`,
    attachments: [
      { filename: `logo.${extension}`, content: Buffer.from(logo.data, 'base64'), contentType: logo.contentType, cid: EMAIL_LOGO_CID },
    ],
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
  return config ? createSmtpDelivery(config) : undefined
}
