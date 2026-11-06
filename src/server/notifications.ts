import { brandedEmailParts, workspaceEmailDelivery, type EmailDelivery } from '../adapters/email'
import type { SmtpEmailConfig } from '../core/auth'
import {
  EMAIL_LOGO_CID,
  EMAIL_LOGO_SETTING,
  EMAIL_SENDER_SETTING,
  EMAIL_TEMPLATES_SETTING,
  WORKSPACE_SMTP_SETTING,
  type EmailBranding,
  type EmailLogo,
  type EmailSender,
  type EmailTemplateKind,
  type EmailTemplates,
} from '../core/email'
import { messagesFor, type Locale } from '../core/i18n'
import { inviteEmail, printReadyEmail } from '../core/notifications'
import type { Notifier, Repository, Telemetry } from '../core/types'
import { decryptSetting, type EncryptedSetting } from './integrations'
import { serverMessages } from './locale'
import { logger } from './logger'

export async function readEmailBranding(repository: Pick<Repository, 'getSetting'>): Promise<EmailBranding> {
  const [logo, sender, templates] = await Promise.all([
    repository.getSetting<EmailLogo>(EMAIL_LOGO_SETTING),
    repository.getSetting<EmailSender>(EMAIL_SENDER_SETTING),
    repository.getSetting<EmailTemplates>(EMAIL_TEMPLATES_SETTING),
  ])
  return { logo, sender, templates }
}

/** `relayed` is true when the mail leaves through the hosted service's shared address rather than the workspace's own server. */
export type WorkspaceMailer = { delivery: EmailDelivery; relayed: boolean; ownServer: boolean }

export async function readWorkspaceSmtp(repository: Pick<Repository, 'getSetting'>) {
  const stored = await repository.getSetting<EncryptedSetting>(WORKSPACE_SMTP_SETTING)
  return stored && decryptSetting<SmtpEmailConfig>(stored)
}

/** Workspace emails go out when the deployment can send or the workspace brings its own mail server. */
export async function workspaceEmailConfigured(deploymentConfigured: boolean, repository?: Pick<Repository, 'getSetting'>) {
  return deploymentConfigured || (repository !== undefined && (await repository.getSetting(WORKSPACE_SMTP_SETTING)) !== undefined)
}

/** Custom templates only leave through the workspace's own mail server, never a shared sending address. */
export function mailerTemplate(mailer: WorkspaceMailer, branding: EmailBranding, kind: EmailTemplateKind) {
  return mailer.ownServer ? branding.templates?.[kind] : undefined
}

/** Written in the inviter's language, the only one known before the recipient has an account. */
export async function sendInviteEmail(
  mailer: WorkspaceMailer,
  branding: EmailBranding,
  invite: { to: string; workspaceName: string; url: string },
) {
  const { logoSrc, ...parts } = brandedEmailParts(branding, mailer.relayed)
  const template = mailerTemplate(mailer, branding, 'invite')
  await mailer.delivery.send({
    to: invite.to,
    ...brandedMessage(
      inviteEmail({ t: serverMessages().email, workspaceName: invite.workspaceName, logoSrc, url: invite.url, template }),
      parts,
    ),
  })
}

/** A custom template may leave the logo out, and an unused inline image shows up as a stray attachment. */
function brandedMessage<Email extends { html: string }>(
  email: Email,
  { attachments, ...headers }: Omit<ReturnType<typeof brandedEmailParts>, 'logoSrc'>,
) {
  return { ...email, ...headers, attachments: email.html.includes(`cid:${EMAIL_LOGO_CID}`) ? attachments : undefined }
}

export async function workspaceMailer(
  repository: Pick<Repository, 'getSetting'>,
  deployment: EmailDelivery | undefined,
  hosted: boolean,
): Promise<WorkspaceMailer | undefined> {
  const own = await readWorkspaceSmtp(repository)
  if (own) return { delivery: workspaceEmailDelivery(own, hosted), relayed: false, ownServer: true }
  return deployment && { delivery: deployment, relayed: hosted, ownServer: false }
}

export type DeliveryTracker = ReturnType<typeof deliveryTracker>

/** Keeps fire-and-forget deliveries reachable so shutdown can wait for them. */
export function deliveryTracker() {
  const pending = new Set<Promise<void>>()
  return {
    track(delivery: Promise<void>) {
      pending.add(delivery)
      void delivery.finally(() => pending.delete(delivery))
      return delivery
    },
    /** Resolves false when deliveries are still running at the deadline. */
    async drain(timeoutMs: number) {
      let timer: ReturnType<typeof setTimeout> | undefined
      const deadline = new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs)
      })
      try {
        return await Promise.race([Promise.allSettled(pending).then(() => true), deadline])
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

export function emailNotifier(options: {
  mailer: () => Promise<WorkspaceMailer | undefined>
  telemetry: Telemetry
  workspaceId: string
  workspaceName: () => Promise<string>
  branding: () => Promise<EmailBranding>
  appUrl: () => string | undefined
  deliveries: DeliveryTracker
  /** The recipient's chosen language; undefined sends English. */
  recipientLocale: (userId: string) => Promise<Locale | undefined>
}): Notifier {
  const deliver: Notifier['printsReady'] = async (recipient, prints) => {
    const url = options.appUrl()
    try {
      const mailer = await options.mailer()
      if (!mailer) return
      const branding = await options.branding()
      const { logoSrc, ...parts } = brandedEmailParts(branding, mailer.relayed)
      const template = mailerTemplate(mailer, branding, 'print-ready')
      const email = printReadyEmail({
        t: messagesFor(await options.recipientLocale(recipient.id)).email,
        workspaceName: await options.workspaceName(),
        logoSrc,
        name: recipient.name,
        prints,
        url,
        template,
      })
      await mailer.delivery.send({ to: recipient.email, ...brandedMessage(email, parts) })
      void options.telemetry
        .capture(recipient.id, 'print_ready_email_sent', {
          request_count: prints.length,
          copy_count: prints.reduce((sum, print) => sum + print.count, 0),
        })
        .catch(() => undefined)
    } catch (error) {
      logger.warn(
        { err: error, event: 'print_ready_email_failed', workspace_id: options.workspaceId },
        'could not send a print-ready email',
      )
    }
  }
  return {
    canSend: async () => (await options.mailer()) !== undefined,
    printsReady: (recipient, prints) => options.deliveries.track(deliver(recipient, prints)),
  }
}
