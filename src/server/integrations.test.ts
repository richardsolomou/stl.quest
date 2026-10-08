import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IntegrationConfig } from '../core/auth'
import {
  decryptIntegrationConfig,
  encryptIntegrationConfig,
  oidcDiscoveryAvailable,
  publicIntegrationConfig,
  socialProviderCredentialsChanged,
} from './integrations'
import { resolveAuthAdapterConfig } from '../adapters/auth'
import { resolveSmtpConfig } from '../adapters/email'

const directories: string[] = []
const environment = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stlquest-integrations-'))
  directories.push(directory)
  return { DATA_DIR: directory }
}

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('integration settings', () => {
  it('requires another sign-in when social provider credentials change', () => {
    const current = { enabled: false, clientId: 'client', clientSecret: 'secret' }

    expect(socialProviderCredentialsChanged(current, 'client', 'replacement')).toBe(true)
    expect(socialProviderCredentialsChanged(current, 'replacement', '')).toBe(true)
    expect(socialProviderCredentialsChanged(current, 'client', '')).toBe(false)
  })

  it('requires another sign-in when the OIDC issuer changes', () => {
    const current = {
      enabled: true,
      clientId: 'client',
      clientSecret: 'secret',
      issuer: 'https://a.example.com',
      scopes: ['openid'],
      name: 'SSO',
    }

    expect(socialProviderCredentialsChanged(current, 'client', '', 'https://b.example.com')).toBe(true)
    expect(socialProviderCredentialsChanged(current, 'client', '', 'https://a.example.com')).toBe(false)
  })

  describe('OIDC discovery check', () => {
    const issuer = 'https://auth.example.com/application/o/stlquest'
    const discovery = {
      issuer,
      authorization_endpoint: 'https://auth.example.com/authorize',
      token_endpoint: 'https://auth.example.com/token',
      jwks_uri: 'https://auth.example.com/jwks',
    }
    const respond = (response: (url: string, init?: RequestInit) => Promise<Response>) =>
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => await response(String(input), init)),
      )
    afterEach(() => vi.unstubAllGlobals())

    it('accepts an issuer that serves a usable discovery document', async () => {
      respond(async (url) =>
        url === `${issuer}/.well-known/openid-configuration` ? Response.json(discovery) : new Response(null, { status: 404 }),
      )

      expect(await oidcDiscoveryAvailable(issuer)).toBe(true)
    })

    it('rejects a discovery document without a JWKS endpoint', async () => {
      respond(async () => Response.json({ ...discovery, jwks_uri: undefined }))

      expect(await oidcDiscoveryAvailable(issuer)).toBe(false)
    })

    it('rejects an issuer that does not serve a discovery document', async () => {
      respond(async () => new Response('not found', { status: 404 }))

      expect(await oidcDiscoveryAvailable(issuer)).toBe(false)
    })

    it('gives up on an issuer that does not respond in time', async () => {
      respond(
        async (_url, init) =>
          await new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))),
      )

      expect(await oidcDiscoveryAvailable(issuer, 10)).toBe(false)
    })
  })

  it('encrypts and decrypts provider secrets with a generated key', () => {
    const config: IntegrationConfig = {
      passwordEnabled: true,
      google: { enabled: true, clientId: 'client', clientSecret: 'secret' },
      dropbox: { clientId: 'dropbox-client', clientSecret: 'dropbox-secret' },
      smtp: { from: 'print@example.com', host: 'smtp.example.com', port: 587, secure: false, password: 'email-secret' },
    }
    const env = environment()
    const encrypted = encryptIntegrationConfig(config, env)

    expect(encrypted.ciphertext).not.toContain('secret')
    expect(encrypted.ciphertext).not.toContain('dropbox-secret')
    expect(decryptIntegrationConfig(encrypted, env)).toEqual(config)
    expect(fs.statSync(path.join(env.DATA_DIR, 'integration-secrets.key')).mode & 0o777).toBe(0o600)
  })

  it('rejects tampered ciphertext', () => {
    const env = environment()
    const encrypted = encryptIntegrationConfig({ passwordEnabled: true }, env)
    const ciphertext = Buffer.from(encrypted.ciphertext, 'base64url')
    ciphertext[0] ^= 1
    encrypted.ciphertext = ciphertext.toString('base64url')
    expect(() => decryptIntegrationConfig(encrypted, env)).toThrow()
  })

  it('masks configured secrets in public settings', () => {
    const config: IntegrationConfig = {
      passwordEnabled: true,
      discord: { enabled: true, clientId: 'client', clientSecret: 'secret' },
      smtp: { from: 'print@example.com', host: 'smtp.example.com', port: 587, secure: false, password: 'token' },
    }
    const settings = publicIntegrationConfig(
      config,
      resolveAuthAdapterConfig(config, {}),
      resolveSmtpConfig(config, {}),
      'https://print.example.com',
      {},
    )

    expect(settings.providers.discord).toMatchObject({ configured: true, enabled: true, clientId: 'client', secretConfigured: true })
    expect(settings.origin).toBe('https://print.example.com')
    expect(settings.smtp).toMatchObject({ configured: true, host: 'smtp.example.com', passwordConfigured: true })
    expect(JSON.stringify(settings)).not.toContain('"clientSecret"')
    expect(JSON.stringify(settings)).not.toContain('"password":"token"')
  })

  it('treats configured cloud storage apps as enabled unless explicitly disabled', () => {
    const configured = publicIntegrationConfig(
      { passwordEnabled: true, dropbox: { clientId: 'client', clientSecret: 'secret' } },
      resolveAuthAdapterConfig({ passwordEnabled: true }, {}),
      undefined,
      'https://print.example.com',
      {},
    )
    const disabled = publicIntegrationConfig(
      { passwordEnabled: true, dropbox: { clientId: 'client', clientSecret: 'secret', enabled: false } },
      resolveAuthAdapterConfig({ passwordEnabled: true }, {}),
      undefined,
      'https://print.example.com',
      {},
    )

    expect(configured.cloudStorage.dropbox.enabled).toBe(true)
    expect(disabled.cloudStorage.dropbox.enabled).toBe(false)
  })
})
