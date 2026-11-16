import { logger } from './logger'

/** What a failed health check may tell the caller; the cause itself stays in the server log. */
export type HealthFailure = { code: string; message: string }

export async function healthResponse(check: () => Promise<void> | void, failure?: (error: unknown) => HealthFailure) {
  const headers = { 'cache-control': 'no-store' }
  try {
    await check()
    return Response.json({ ok: true }, { headers })
  } catch (error) {
    // A warning, not an error, so a restart loop does not report an exception per probe.
    logger.warn({ err: error, event: 'health_check_failed' }, 'health check failed')
    const reported = failure?.(error)
    return Response.json(
      reported ? { ok: false, error: reported.message, code: reported.code } : { ok: false, error: 'health check failed' },
      {
        status: 503,
        headers,
      },
    )
  }
}
