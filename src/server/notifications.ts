import { brandedEmailParts, type EmailDelivery } from '../adapters/email'
import { EMAIL_LOGO_SETTING, EMAIL_SENDER_SETTING, type EmailBranding, type EmailLogo, type EmailSender } from '../core/email'
import { printReadyEmail } from '../core/notifications'
import type { Notifier, Repository, Telemetry } from '../core/types'
import { logger } from './logger'

export async function readEmailBranding(repository: Pick<Repository, 'getSetting'>): Promise<EmailBranding> {
  const [logo, sender] = await Promise.all([
    repository.getSetting<EmailLogo>(EMAIL_LOGO_SETTING),
    repository.getSetting<EmailSender>(EMAIL_SENDER_SETTING),
  ])
  return { logo, sender }
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
  email: EmailDelivery
  telemetry: Telemetry
  workspaceId: string
  workspaceName: () => Promise<string>
  branding: () => Promise<EmailBranding>
  hosted: boolean
  appUrl: () => string | undefined
  deliveries: DeliveryTracker
}): Notifier {
  const deliver: Notifier['printsReady'] = async (recipient, prints) => {
    const url = options.appUrl()
    try {
      const { logoSrc, ...headers } = brandedEmailParts(await options.branding(), options.hosted)
      await options.email.send({
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
