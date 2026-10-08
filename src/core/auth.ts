import { authFailureMessage, classifySignInFailure, type SignInFailureReason } from 'ras-stack/auth/client'

export const SOCIAL_AUTH_PROVIDERS = ['google', 'discord', 'oidc'] as const
export type SocialAuthProvider = (typeof SOCIAL_AUTH_PROVIDERS)[number]
export const SOCIAL_AUTH_PROVIDER_NAMES = { google: 'Google', discord: 'Discord', oidc: 'SSO' } as const satisfies Record<
  SocialAuthProvider,
  string
>

export function socialProviderName(provider: SocialAuthProvider, oidcName?: string) {
  return (provider === 'oidc' && oidcName) || SOCIAL_AUTH_PROVIDER_NAMES[provider]
}

export const OIDC_DEFAULT_SCOPES = ['openid', 'email', 'profile'] as const
export const OIDC_NAME_MAX_LENGTH = 50
const OIDC_DISCOVERY_PATH = '/.well-known/openid-configuration'

export function normalizeOidcIssuer(value: string): string | undefined {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return undefined
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || url.search || url.hash) return undefined
  const path = url.pathname.endsWith(OIDC_DISCOVERY_PATH) ? url.pathname.slice(0, -OIDC_DISCOVERY_PATH.length) : url.pathname
  return `${url.origin}${path.replace(/\/+$/, '')}`
}

export function oidcDiscoveryUrl(issuer: string) {
  return `${issuer}${OIDC_DISCOVERY_PATH}`
}

// Discovery §4.3 requires the discovered issuer to be identical to the issuer it was fetched from; §4.1 drops a terminating
// slash before appending the well-known path, so that slash is the only difference accepted from the normalized issuer.
export function oidcIssuerMatches(issuer: string, discovered: unknown) {
  return discovered === issuer || discovered === `${issuer}/`
}

export function parseOidcScopes(value: string | undefined): string[] {
  const scopes = (value ?? '').split(/[\s,]+/).filter(Boolean)
  return [...new Set(['openid', ...(scopes.length > 0 ? scopes : OIDC_DEFAULT_SCOPES)])]
}

export function oidcDisplayName(value: string | undefined) {
  return value?.trim().slice(0, OIDC_NAME_MAX_LENGTH) || SOCIAL_AUTH_PROVIDER_NAMES.oidc
}

// Subjects are only unique per issuer, so OIDC account links are keyed by both.
export function oidcAccountId(issuer: string, subject: string) {
  return `${issuer}#${subject}`
}

// An OIDC link made under a previous issuer can no longer sign in, so it does not count as a linked method.
export function linkedAccountActive(account: { providerId: string; accountId: string }, oidcIssuer: string | undefined) {
  return account.providerId !== 'oidc' || (oidcIssuer !== undefined && account.accountId.startsWith(oidcAccountId(oidcIssuer, '')))
}

export const signInFailureReason = classifySignInFailure

export function signInFailureMessage(failed: { status?: number; code?: string; message?: string } | null | undefined): string {
  switch (signInFailureReason(failed)) {
    case 'rate_limited':
      return 'Too many sign-in attempts. Wait a minute, then try again.'
    case 'invalid_credentials':
      return 'Email or password is incorrect.'
    default:
      return authFailureMessage(failed, 'Something went wrong signing in. Try again.')
  }
}

export type { SignInFailureReason }

export type AuthCapabilities = {
  password: boolean
  passwordReset: boolean
  socialProviders: SocialAuthProvider[]
  oidcName?: string
}

export type SignInCapabilities = AuthCapabilities & { selfSignup: boolean }

export type SocialProviderConfig = {
  enabled: boolean
  clientId: string
  clientSecret: string
}

export type OidcProviderConfig = SocialProviderConfig & {
  issuer: string
  scopes: string[]
  name: string
}

export type SocialProviderConfigs = {
  google?: SocialProviderConfig
  discord?: SocialProviderConfig
  oidc?: OidcProviderConfig
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

export type IntegrationConfig = SocialProviderConfigs & {
  passwordEnabled: boolean
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

export type AuthAdapterConfig = AuthCapabilities & SocialProviderConfigs
export type EmailCapabilities = { configured: boolean }

export type PublicSocialProviderConfig = {
  configured: boolean
  enabled: boolean
  linked: boolean
  clientId: string
  secretConfigured: boolean
  source: 'database' | 'environment'
  issuer?: string
  scopes?: string[]
  name?: string
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
