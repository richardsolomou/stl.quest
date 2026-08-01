import { errorMessage } from './error'

export const SOCIAL_AUTH_PROVIDERS = ['google', 'discord'] as const
export type SocialAuthProvider = (typeof SOCIAL_AUTH_PROVIDERS)[number]
export const SOCIAL_AUTH_PROVIDER_NAMES = { google: 'Google', discord: 'Discord' } as const satisfies Record<SocialAuthProvider, string>

// Anonymous, categorical reason a password sign-in was rejected. Used both to pick the message shown
// to the user and as the sole property on the `user_sign_in_failed` telemetry event.
export type SignInFailureReason = 'invalid_credentials' | 'rate_limited' | 'error'

// Classify a better-auth sign-in rejection. The client only reliably sees the HTTP status and an
// optional error code once the response crosses the fetch boundary: 429 is the rate limiter (10
// attempts / 60s on `/sign-in/email`), 401 is genuinely bad credentials, and anything else (a
// transport failure with no status, a 500) is an unexpected error we must never blame on the
// password — the more someone retries into the limiter, the more confidently that lie compounds.
export function signInFailureReason(failed: { status?: number; code?: string } | null | undefined): SignInFailureReason {
  if (failed?.status === 429) return 'rate_limited'
  if (failed?.status === 401 || failed?.code === 'INVALID_EMAIL_OR_PASSWORD') return 'invalid_credentials'
  return 'error'
}

// The message to show for a rejected sign-in. Credential and rate-limit cases get purpose-written
// copy; every other failure mirrors the sign-up branch and surfaces the server's own message.
export function signInFailureMessage(failed: { status?: number; code?: string; message?: string } | null | undefined): string {
  switch (signInFailureReason(failed)) {
    case 'rate_limited':
      return 'Too many sign-in attempts. Wait a minute, then try again.'
    case 'invalid_credentials':
      return 'Email or password is incorrect.'
    default:
      return errorMessage(failed, 'Something went wrong signing in. Try again.')
  }
}

export type AuthCapabilities = {
  password: boolean
  passwordReset: boolean
  socialProviders: SocialAuthProvider[]
}

export type SocialProviderConfig = {
  enabled: boolean
  clientId: string
  clientSecret: string
}

export type SmtpEmailConfig = {
  from: string
  host: string
  port: number
  secure: boolean
  user?: string
  password?: string
  testedAt?: number
}

export const CLOUD_STORAGE_PROVIDERS = ['dropbox', 'google-drive', 'onedrive', 'box'] as const
export type CloudStorageProvider = (typeof CLOUD_STORAGE_PROVIDERS)[number]
export const CLOUD_STORAGE_PROVIDER_NAMES = {
  dropbox: 'Dropbox',
  'google-drive': 'Google Drive',
  onedrive: 'OneDrive',
  box: 'Box',
} as const satisfies Record<CloudStorageProvider, string>

export function cloudStorageProviderName(provider: CloudStorageProvider) {
  return CLOUD_STORAGE_PROVIDER_NAMES[provider]
}

// The OAuth app identifies STL Quest to the provider and belongs to the deployment; the account that consents belongs to a workspace.
export type CloudStorageApp = {
  clientId: string
  clientSecret: string
  enabled?: boolean
}

// What an asset store needs: the deployment's app plus the workspace's authorised account.
export type CloudStorageCredentials = CloudStorageApp & { refreshToken?: string }

export type CloudStorageConnection = {
  refreshToken: string
  accountId?: string
  accountName?: string
  accountEmail?: string
  connectedAt?: number
}

export type PendingCloudAuthorization = {
  provider: CloudStorageProvider
  stateHash: string
  adminId: string
  redirectUri: string
  returnTo: string
  expiresAt: number
}

export type WorkspaceCloudStorage = {
  connections?: Partial<Record<CloudStorageProvider, CloudStorageConnection>>
  pending?: PendingCloudAuthorization
}

export type IntegrationConfig = {
  passwordEnabled: boolean
  google?: SocialProviderConfig
  discord?: SocialProviderConfig
  dropbox?: CloudStorageApp
  googleDrive?: CloudStorageApp
  oneDrive?: CloudStorageApp
  box?: CloudStorageApp
  smtp?: SmtpEmailConfig
}

export const CLOUD_STORAGE_APP_KEYS = {
  dropbox: 'dropbox',
  'google-drive': 'googleDrive',
  onedrive: 'oneDrive',
  box: 'box',
} as const satisfies Record<CloudStorageProvider, keyof IntegrationConfig>

export type AuthAdapterConfig = AuthCapabilities & Partial<Record<SocialAuthProvider, SocialProviderConfig>>
export type EmailCapabilities = { configured: boolean }

export type PublicSocialProviderConfig = {
  configured: boolean
  enabled: boolean
  linked: boolean
  clientId: string
  secretConfigured: boolean
  source: 'database' | 'environment'
}

export type PublicSmtpConfig = {
  configured: boolean
  from: string
  source?: 'database' | 'environment'
  testedAt?: number
  host: string
  port: number
  secure: boolean
  user?: string
  passwordConfigured: boolean
}

export type PublicIntegrationConfig = {
  origin: string
  passwordEnabled: boolean
  passwordForcedByRecovery: boolean
  passwordSource: 'database' | 'environment'
  providers: Record<SocialAuthProvider, PublicSocialProviderConfig>
  cloudStorage: Record<CloudStorageProvider, PublicCloudStorageApp>
  smtp: PublicSmtpConfig
}

export type PublicCloudStorageApp = {
  configured: boolean
  enabled: boolean
  clientId: string
  secretConfigured: boolean
  callbackUrl: string
}

export type PublicCloudConnection = {
  available: boolean
  connected: boolean
  accountName?: string
  accountEmail?: string
}
