import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type {
  AuthAdapterConfig,
  CloudStorageProvider,
  IntegrationConfig,
  PublicIntegrationConfig,
  PublicSocialProviderConfig,
  SocialAuthProvider,
  SmtpEmailConfig,
} from '../core/auth'
import { environmentFlag } from '../adapters/environment'
import { CLOUD_STORAGE_APP_KEYS, CLOUD_STORAGE_PROVIDERS, SOCIAL_AUTH_PROVIDERS } from '../core/auth'

const SETTING_KEY = 'integrations'
const KEY_BYTES = 32

export type EncryptedSetting = { version: 1; iv: string; tag: string; ciphertext: string }
export type SettingStore = {
  getSetting<T>(key: string): Promise<T | undefined>
  setSetting(key: string, value: unknown): Promise<void>
}

function encryptionKey(environment: NodeJS.ProcessEnv = process.env) {
  const configured = environment.INTEGRATIONS_ENCRYPTION_KEY?.trim()
  if (configured) {
    const key = Buffer.from(configured, 'base64url')
    if (key.length !== KEY_BYTES) throw new Error('INTEGRATIONS_ENCRYPTION_KEY must be a base64url-encoded 32-byte key')
    return key
  }
  const file = path.join(path.resolve(environment.DATA_DIR ?? '/data'), 'integration-secrets.key')
  try {
    const key = fs.readFileSync(file)
    if (key.length !== KEY_BYTES) throw new Error(`${file} must contain exactly ${KEY_BYTES} bytes`)
    return key
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const key = crypto.randomBytes(KEY_BYTES)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, key, { mode: 0o600, flag: 'wx' })
    return key
  }
}

export function encryptSetting(value: unknown, environment: NodeJS.ProcessEnv = process.env): EncryptedSetting {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(environment), iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return {
    version: 1,
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  }
}

export function decryptSetting<T>(setting: EncryptedSetting, environment: NodeJS.ProcessEnv = process.env): T {
  if (setting.version !== 1) throw new Error('unsupported integration settings version')
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(environment), Buffer.from(setting.iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(setting.tag, 'base64url'))
  const plaintext = Buffer.concat([decipher.update(Buffer.from(setting.ciphertext, 'base64url')), decipher.final()])
  return JSON.parse(plaintext.toString('utf8')) as T
}

export function encryptIntegrationConfig(config: IntegrationConfig, environment: NodeJS.ProcessEnv = process.env): EncryptedSetting {
  return encryptSetting(config, environment)
}

export function decryptIntegrationConfig(setting: EncryptedSetting, environment: NodeJS.ProcessEnv = process.env): IntegrationConfig {
  return decryptSetting<IntegrationConfig>(setting, environment)
}

export async function getStoredIntegrationConfig(
  repository: SettingStore,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<IntegrationConfig | undefined> {
  const setting = await repository.getSetting<EncryptedSetting>(SETTING_KEY)
  return setting ? decryptIntegrationConfig(setting, environment) : undefined
}

export async function setStoredIntegrationConfig(
  repository: SettingStore,
  config: IntegrationConfig,
  environment: NodeJS.ProcessEnv = process.env,
) {
  await repository.setSetting(SETTING_KEY, encryptIntegrationConfig(config, environment))
}

export function socialProviderCredentialsChanged(current: IntegrationConfig[SocialAuthProvider], clientId: string, clientSecret: string) {
  return current?.clientId !== clientId || (clientSecret !== '' && current?.clientSecret !== clientSecret)
}

function providerSource(provider: SocialAuthProvider, environment: NodeJS.ProcessEnv) {
  const prefix = `AUTH_${provider.toUpperCase()}`
  return environment[`${prefix}_CLIENT_ID`]?.trim() || environment[`${prefix}_CLIENT_SECRET`]?.trim() ? 'environment' : 'database'
}

function publicProvider(
  provider: SocialAuthProvider,
  stored: IntegrationConfig | undefined,
  effective: AuthAdapterConfig,
  environment: NodeJS.ProcessEnv,
): PublicSocialProviderConfig {
  const config = effective[provider]
  return {
    configured: config !== undefined,
    enabled: effective.socialProviders.includes(provider),
    linked: false,
    clientId: config?.clientId ?? '',
    secretConfigured: Boolean(config?.clientSecret),
    source: providerSource(provider, environment),
  }
}

function publicCloudStorageApp(provider: CloudStorageProvider, stored: IntegrationConfig | undefined, origin: string) {
  const app = stored?.[CLOUD_STORAGE_APP_KEYS[provider]]
  return {
    configured: Boolean(app?.clientId && app.clientSecret),
    enabled: Boolean(app?.clientId && app.clientSecret && app.enabled !== false),
    clientId: app?.clientId ?? '',
    secretConfigured: Boolean(app?.clientSecret),
    callbackUrl: `${origin}/api/storage/${provider}/callback`,
  }
}

export function publicIntegrationConfig(
  stored: IntegrationConfig | undefined,
  auth: AuthAdapterConfig,
  smtp: SmtpEmailConfig | undefined,
  origin: string,
  environment: NodeJS.ProcessEnv = process.env,
): PublicIntegrationConfig {
  const passwordForcedByRecovery = environmentFlag(environment.AUTH_PASSWORD_RECOVERY)
  const environmentSmtp = Boolean(environment.SMTP_HOST?.trim())
  return {
    origin,
    passwordEnabled: auth.password,
    passwordForcedByRecovery,
    passwordSource: passwordForcedByRecovery || environment.AUTH_PASSWORD_ENABLED !== undefined ? 'environment' : 'database',
    providers: Object.fromEntries(
      SOCIAL_AUTH_PROVIDERS.map((provider) => [provider, publicProvider(provider, stored, auth, environment)]),
    ) as PublicIntegrationConfig['providers'],
    cloudStorage: Object.fromEntries(
      CLOUD_STORAGE_PROVIDERS.map((provider) => [provider, publicCloudStorageApp(provider, stored, origin)]),
    ) as PublicIntegrationConfig['cloudStorage'],
    smtp: {
      configured: smtp !== undefined,
      from: smtp?.from ?? '',
      source: smtp ? (environmentSmtp ? 'environment' : 'database') : undefined,
      testedAt: environmentSmtp ? undefined : smtp?.testedAt,
      host: smtp?.host ?? '',
      port: smtp?.port ?? 587,
      secure: smtp?.secure ?? false,
      user: smtp?.user,
      passwordConfigured: Boolean(smtp?.password),
    },
  }
}
