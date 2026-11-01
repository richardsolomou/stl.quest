import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PRICE_CALCULATOR_SETTINGS } from '../core/priceCalculator'
import { MAX_EMAIL_LOGO_BYTES } from '../core/email'
import {
  assertWorkspaceSmtpPort,
  canViewManagedStorageUsage,
  captureRouteError,
  keptSmtpPassword,
  parseEmailLogo,
  storedPriceCalculatorSettings,
} from './fns'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

describe('managed storage usage', () => {
  it('hides account-level usage from requesters', () => {
    expect(canViewManagedStorageUsage('requester')).toBe(false)
  })

  it('shows account-level usage to admins', () => {
    expect(canViewManagedStorageUsage('admin')).toBe(true)
  })
})

describe('route errors', () => {
  it('reports the original browser error through server telemetry', async () => {
    const exception = vi.fn(async () => undefined)

    await captureRouteError(
      { exception },
      { name: 'TypeError', message: 'workspace failed', stack: 'TypeError: workspace failed\n    at route.tsx:1:1' },
    )

    expect(exception).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'TypeError', message: 'workspace failed', stack: expect.stringContaining('route.tsx:1:1') }),
      { action: 'route_error' },
    )
  })
})

describe('price calculator settings', () => {
  it('reports defaults as unsaved before the workspace saves a setup', () => {
    expect(storedPriceCalculatorSettings(undefined)).toEqual({ settings: DEFAULT_PRICE_CALCULATOR_SETTINGS, saved: false })
  })

  it('reports a saved setup as saved', () => {
    expect(storedPriceCalculatorSettings({ resinPricePerLitre: 80 })).toEqual({
      settings: { ...DEFAULT_PRICE_CALCULATOR_SETTINGS, resinPricePerLitre: 80 },
      saved: true,
    })
  })

  it('keeps euros for a setup saved before the currency setting existed', () => {
    expect(storedPriceCalculatorSettings({ resinPricePerLitre: 80 }).settings.currency).toBe('EUR')
    expect(storedPriceCalculatorSettings({ currency: 'CAD' }).settings.currency).toBe('CAD')
  })
})

describe('email logo', () => {
  it('detects the image type from its bytes', () => {
    expect(parseEmailLogo(PNG.toString('base64')).contentType).toBe('image/png')
  })

  it('rejects images email clients cannot show', async () => {
    const webp = Buffer.from('RIFF\0\0\0\0WEBPVP8 ')
    expect(await rejection(() => parseEmailLogo(webp.toString('base64')))).toBe(400)
  })

  it('rejects files that are not images', async () => {
    expect(await rejection(() => parseEmailLogo(Buffer.from('<svg></svg>').toString('base64')))).toBe(400)
  })

  it('rejects logos over the size limit', async () => {
    const large = Buffer.concat([PNG, Buffer.alloc(MAX_EMAIL_LOGO_BYTES)])
    expect(await rejection(() => parseEmailLogo(large.toString('base64')))).toBe(413)
  })
})

async function rejection(action: () => unknown) {
  try {
    action()
  } catch (error) {
    if (error instanceof Response) return error.status
    throw error
  }
  throw new Error('expected a rejected logo')
}

describe('workspace SMTP password', () => {
  const current = { from: 'shop@example.com', host: 'smtp.example.com', port: 587, secure: false, user: 'shop', password: 'secret' }

  it('keeps the stored password for the same host and username', () => {
    expect(keptSmtpPassword(current, { host: 'smtp.example.com', user: 'shop' })).toBe('secret')
  })

  it('drops the stored password when the host changes', () => {
    expect(keptSmtpPassword(current, { host: 'smtp.attacker.example', user: 'shop' })).toBeUndefined()
  })

  it('drops the stored password when the username changes', () => {
    expect(keptSmtpPassword(current, { host: 'smtp.example.com', user: 'other' })).toBeUndefined()
  })
})

describe('workspace SMTP port', () => {
  it('refuses a non-submission port on the hosted service', async () => {
    expect(await rejection(() => assertWorkspaceSmtpPort(6379, true))).toBe(400)
  })

  it('allows a submission port on the hosted service', () => {
    expect(() => assertWorkspaceSmtpPort(587, true)).not.toThrow()
  })

  it('allows any port on a self-hosted server', () => {
    expect(() => assertWorkspaceSmtpPort(25, false)).not.toThrow()
  })
})
