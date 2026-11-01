import { brandedEmailParts, workspaceEmailDelivery, type EmailDelivery } from '../adapters/email'
import type { SmtpEmailConfig } from '../core/auth'
import {
  EMAIL_LOGO_SETTING,
  EMAIL_SENDER_SETTING,
  WORKSPACE_SMTP_SETTING,
  type EmailBranding,
  type EmailLogo,
  type EmailSender,
} from '../core/email'
import { printReadyEmail } from '../core/notifications'
import type { Notifier, Repository, Telemetry } from '../core/types'
import { decryptSetting, type EncryptedSetting } from './integrations'
import { logger } from './logger'

export async function readEmailBranding(repository: Pick<Repository, 'getSetting'>): Promise<EmailBranding> {
  const [logo, sender] = await Promise.all([
    repository.getSetting<EmailLogo>(EMAIL_LOGO_SETTING),
    repository.getSetting<EmailSender>(EMAIL_SENDER_SETTING),
  ])
  return { logo, sender }
}

/** `relayed` is true when the mail leaves through the hosted service's shared address rather than the workspace's own server. */
export type WorkspaceMailer = { delivery: EmailDelivery; relayed: boolean }

export async function readWorkspaceSmtp(repository: Pick<Repository, 'getSetting'>) {
  const stored = await repository.getSetting<EncryptedSetting>(WORKSPACE_SMTP_SETTING)
  return stored && decryptSetting<SmtpEmailConfig>(stored)
}

/** Workspace emails go out when the deployment can send or the workspace brings its own mail server. */
export async function workspaceEmailConfigured(deploymentConfigured: boolean, repository?: Pick<Repository, 'getSetting'>) {
  return deploymentConfigured || (repository !== undefined && (await repository.getSetting(WORKSPACE_SMTP_SETTING)) !== undefined)
}

export async function workspaceMailer(
  repository: Pick<Repository, 'getSetting'>,
  deployment: EmailDelivery | undefined,
  hosted: boolean,
): Promise<WorkspaceMailer | undefined> {
  const own = await readWorkspaceSmtp(repository)
  if (own) return { delivery: workspaceEmailDelivery(own, hosted), relayed: false }
  return deployment && { delivery: deployment, relayed: hosted }
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
}): Notifier {
  const deliver: Notifier['printsReady'] = async (recipient, prints) => {
    const url = options.appUrl()
    try {
      const mailer = await options.mailer()
      if (!mailer) return
      const { logoSrc, ...headers } = brandedEmailParts(await options.branding(), mailer.relayed)
      await mailer.delivery.send({
        to: recipient.email,
        ...printReadyEmail({ workspaceName: await options.workspaceName(), logoSrc, prints, url }),
        ...headers,
      })
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
  return { printsReady: (recipient, prints) => options.deliveries.track(deliver(recipient, prints)) }
}
