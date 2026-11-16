import net from 'node:net'
import { createTransport, type Transporter } from 'nodemailer'
import type { IntegrationConfig, SmtpEmailConfig } from '../core/auth'
import { EMAIL_LOGO_CID, senderDisplayName, type EmailBranding } from '../core/email'
import { resolvePublicAddress } from './outbound'
import { environmentFlag } from './environment'

const SMTP_TIMEOUT_MS = 20_000

/** `cid` lets the HTML body show the attachment inline as `cid:<value>`. */
export type EmailAttachment = { filename: string; content: Buffer; contentType: string; cid?: string }

export type EmailMessage = {
  to: string
  subject: string
  text: string
  html?: string
  attachments?: EmailAttachment[]
  /** Replaces the configured sender's display name; the address stays the configured one so SPF and DKIM still pass. */
  fromName?: string
  replyTo?: string
}

export type EmailDelivery = {
  send(message: EmailMessage): Promise<void>
  /** Connects and authenticates without sending, to check settings someone just entered. */
  verify(): Promise<void>
}

export type SmtpConfig = {
  from: string
  host: string
  port: number
  secure: boolean
  user?: string
  password?: string
  /** The name TLS presents and verifies when `host` is an address the application resolved and checked itself. */
  servername?: string
  timeoutMs?: number
}

export function smtpConfigFromEnvironment(environment: NodeJS.ProcessEnv = process.env): SmtpConfig | undefined {
  const host = environment.SMTP_HOST?.trim()
  const from = environment.EMAIL_FROM?.trim()
  if (!host && !from) return undefined
  if (!host) throw new Error('SMTP_HOST is required for SMTP email')
  if (!from) throw new Error('EMAIL_FROM is required for SMTP email')

  const port = Number(environment.SMTP_PORT ?? 587)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('SMTP_PORT must be a valid TCP port')

  const user = environment.SMTP_USER?.trim()
  const password = environment.SMTP_PASSWORD
  if (Boolean(user) !== Boolean(password)) throw new Error('SMTP_USER and SMTP_PASSWORD must be configured together')

  return {
    from,
    host,
    port,
    secure: environmentFlag(environment.SMTP_SECURE),
    ...(user && password ? { user, password } : {}),
  }
}

/** Every send and verify fails and disconnects after `timeoutMs`, and each wait on the server is bounded by the same limit. */
export function smtpDelivery(config: SmtpConfig): EmailDelivery {
  const timeoutMs = config.timeoutMs ?? SMTP_TIMEOUT_MS
  const options = {
    host: config.host,
    port: config.port,
    secure: config.secure,
    servername: config.servername,
    auth: config.user ? { user: config.user, pass: config.password } : undefined,
    // Without it, a stripped STARTTLS offer would make nodemailer send the password in plain text.
    requireTLS: Boolean(config.user),
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
  }
  const exchange = async (work: (transport: Transporter) => Promise<unknown>) => {
    // nodemailer cannot abort an exchange, so each one gets its own socket for the deadline to destroy.
    const socket = new net.Socket()
    await withinDeadline(work(createTransport({ ...options, socket })), timeoutMs, () => {
      socket.destroy()
      // Connecting revives a destroyed socket, so one the deadline beat to connecting closes as soon as it opens.
      socket.once('connect', () => socket.destroy())
    })
  }
  return {
    send: ({ fromName, ...message }) =>
      exchange((transport) =>
        transport.sendMail({ from: fromName ? { name: fromName, address: senderAddress(config.from) } : config.from, ...message }),
      ),
    verify: () => exchange((transport) => transport.verify()),
  }
}

// A server that trickles bytes keeps each socket wait short of its timeout, so the whole exchange needs its own deadline.
async function withinDeadline(work: Promise<unknown>, timeoutMs: number, abort: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      abort()
      reject(new Error(`SMTP server did not finish within ${timeoutMs} ms`))
    }, timeoutMs)
  })
  try {
    await Promise.race([work, deadline])
  } finally {
    clearTimeout(timer)
  }
}

function senderAddress(from: string) {
  return /<([^<>]+)>\s*$/.exec(from)?.[1] ?? from
}

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

/** `SMTP_HOST` moves email to the environment; without it, the server saved in the super admin settings sends. */
export function resolveSmtpConfig(stored?: IntegrationConfig, environment: NodeJS.ProcessEnv = process.env): SmtpEmailConfig | undefined {
  if (!environment.SMTP_HOST?.trim()) return stored?.smtp
  return smtpConfigFromEnvironment(environment)
}

export function buildEmailDelivery(config?: SmtpEmailConfig): EmailDelivery | undefined {
  return config ? smtpDelivery(config) : undefined
}

/** A hosted workspace's own mail server is reached at an address checked to be public, with TLS still verified for its name. */
export function workspaceEmailDelivery(config: SmtpEmailConfig, hosted: boolean): EmailDelivery {
  if (!hosted) return smtpDelivery(config)
  const connect = async () =>
    smtpDelivery({ ...config, host: await resolvePublicAddress(config.host), servername: net.isIP(config.host) ? undefined : config.host })
  return { send: async (message) => (await connect()).send(message), verify: async () => (await connect()).verify() }
}
