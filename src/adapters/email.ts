import net from 'node:net'
import { createSmtpDelivery, type EmailDelivery, type EmailMessage } from 'ras-stack/email'
import type { IntegrationConfig, SmtpEmailConfig } from '../core/auth'
import { EMAIL_LOGO_CID, senderDisplayName, type EmailBranding } from '../core/email'
import { environmentFlag } from './environment'
import { resolvePublicAddress } from './outbound'

export type { EmailDelivery, EmailMessage }

/** Embeds the logo inline so it shows even when the server is unreachable from the recipient's mail client. */
export function brandedEmailParts(branding: EmailBranding, relayed: boolean) {
  const { logo, sender } = branding
  return {
    logoSrc: logo && `cid:${EMAIL_LOGO_CID}`,
    attachments: logo && [
      {
        filename: `logo.${logo.contentType.slice('image/'.length)}`,
        content: Buffer.from(logo.data, 'base64'),
        contentType: logo.contentType,
        cid: EMAIL_LOGO_CID,
      },
    ],
    fromName: senderDisplayName(sender?.name, relayed),
    replyTo: sender?.replyTo,
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

const HOSTED_SMTP_TIMEOUT_MS = 20_000

/** A hosted workspace's own mail server is reached at an address checked to be public, with TLS still verified for its name and a deadline on the exchange. */
export function workspaceEmailDelivery(config: SmtpEmailConfig, hosted: boolean): EmailDelivery {
  if (!hosted) return createSmtpDelivery(config)
  const connect = async () =>
    createSmtpDelivery({
      ...config,
      host: await resolvePublicAddress(config.host),
      servername: net.isIP(config.host) ? undefined : config.host,
      timeoutMs: HOSTED_SMTP_TIMEOUT_MS,
    })
  return { send: async (message) => (await connect()).send(message), verify: async () => (await connect()).verify() }
}
