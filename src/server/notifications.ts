import type { EmailDelivery } from '../adapters/email'
import { printReadyEmail } from '../core/notifications'
import type { Notifier, Telemetry } from '../core/types'
import { logger } from './logger'

export function emailNotifier(options: {
  email: EmailDelivery
  telemetry: Telemetry
  workspaceId: string
  workspaceName: () => Promise<string>
  appUrl: () => string | undefined
}): Notifier {
  return {
    async printsReady(recipient, prints) {
      const url = options.appUrl()
      try {
        await options.email.send({
          to: recipient.email,
          ...printReadyEmail({ workspaceName: await options.workspaceName(), prints, url }),
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
    },
  }
}
