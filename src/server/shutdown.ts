import type { NitroAppPlugin } from 'nitro/types'
import { closeApp } from './app'
import { logger } from './logger'

/**
 * Closes the app's resources once Nitro has stopped accepting requests and drained the ones in flight, which it does on
 * `SIGTERM` and `SIGINT`, so no request loses its database connection mid-way.
 */
const shutdown: NitroAppPlugin = (nitro) => {
  nitro.hooks.hook('close', async () => {
    try {
      await closeApp()
    } catch (error) {
      logger.error({ err: error, event: 'shutdown_failed' }, 'shutdown failed')
      process.exitCode = 1
    }
  })
}

export default shutdown
