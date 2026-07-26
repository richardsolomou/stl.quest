import { afterEach, describe, expect, it, vi } from 'vitest'
import { logger, setTelemetryExporters } from './logger'

const originalLevel = logger.level

afterEach(() => {
  logger.level = originalLevel
  setTelemetryExporters(undefined)
})

describe('server logger telemetry', () => {
  it('forwards logged errors to error tracking', () => {
    const exception = vi.fn()
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    logger.level = 'error'
    setTelemetryExporters({ exception, log: vi.fn() })
    const failure = new Error('database unavailable')

    logger.error({ err: failure }, 'request failed')

    expect(exception).toHaveBeenCalledWith(failure, {})
    output.mockRestore()
  })

  it('forwards redacted structured records to log export', () => {
    const log = vi.fn()
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    logger.level = 'error'
    setTelemetryExporters({ exception: vi.fn(), log })

    logger.error(
      {
        password: 'secret',
        relativePath: 'private/model.stl',
        requestId: 'request-id',
        err: { config: { headers: { authorization: 'Bearer nested-secret' }, refreshToken: 'nested-token' } },
      },
      'request failed',
    )

    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        password: '[Redacted]',
        relativePath: '[Redacted]',
        requestId: 'request-id',
        err: { config: { headers: { authorization: '[Redacted]' }, refreshToken: '[Redacted]' } },
        msg: 'request failed',
      }),
    )
    expect(output).not.toHaveBeenCalledWith(expect.stringContaining('nested-secret'))
    expect(output).not.toHaveBeenCalledWith(expect.stringContaining('nested-token'))
    output.mockRestore()
  })
})
