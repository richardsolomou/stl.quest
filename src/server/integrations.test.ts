import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { IntegrationConfig } from '../core/auth'
import { decryptIntegrationConfig, encryptIntegrationConfig, publicIntegrationConfig } from './integrations'
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
  it('encrypts and decrypts provider secrets with a generated key', () => {
    const config: IntegrationConfig = {
      passwordEnabled: true,
      google: { enabled: true, clientId: 'client', clientSecret: 'secret' },
      dropbox: { clientId: 'dropbox-client', clientSecret: 'dropbox-secret', refreshToken: 'dropbox-refresh' },
      smtp: { from: 'print@example.com', host: 'smtp.example.com', port: 587, secure: false, password: 'email-secret' },
    }
    const env = environment()
    const encrypted = encryptIntegrationConfig(config, env)

    expect(encrypted.ciphertext).not.toContain('secret')
    expect(encrypted.ciphertext).not.toContain('dropbox-refresh')
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
    const settings = publicIntegrationConfig(config, resolveAuthAdapterConfig(config, {}), resolveSmtpConfig(config, {}), {})

    expect(settings.providers.discord).toMatchObject({ configured: true, enabled: true, clientId: 'client', secretConfigured: true })
    expect(settings.smtp).toMatchObject({ configured: true, host: 'smtp.example.com', passwordConfigured: true })
    expect(JSON.stringify(settings)).not.toContain('"clientSecret"')
    expect(JSON.stringify(settings)).not.toContain('"password":"token"')
  })
})
