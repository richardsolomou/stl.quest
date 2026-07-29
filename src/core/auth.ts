export const SOCIAL_AUTH_PROVIDERS = ['google', 'discord'] as const
export type SocialAuthProvider = (typeof SOCIAL_AUTH_PROVIDERS)[number]

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

export const CLOUD_STORAGE_PROVIDERS = ['dropbox', 'google-drive', 'onedrive'] as const
export type CloudStorageProvider = (typeof CLOUD_STORAGE_PROVIDERS)[number]
export const CLOUD_STORAGE_PROVIDER_NAMES = {
  dropbox: 'Dropbox',
  'google-drive': 'Google Drive',
  onedrive: 'OneDrive',
} as const satisfies Record<CloudStorageProvider, string>

export function cloudStorageProviderName(provider: CloudStorageProvider) {
  return CLOUD_STORAGE_PROVIDER_NAMES[provider]
}

// The OAuth app identifies STL Quest to the provider and belongs to the deployment; the account that consents belongs to a workspace.
export type CloudStorageApp = {
  clientId: string
  clientSecret: string
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
  smtp?: SmtpEmailConfig
}

export const CLOUD_STORAGE_APP_KEYS = {
  dropbox: 'dropbox',
  'google-drive': 'googleDrive',
  onedrive: 'oneDrive',
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
  passwordEnabled: boolean
  passwordForcedByRecovery: boolean
  passwordSource: 'database' | 'environment'
  providers: Record<SocialAuthProvider, PublicSocialProviderConfig>
  cloudStorage: Record<CloudStorageProvider, PublicCloudStorageApp>
  smtp: PublicSmtpConfig
}

export type PublicCloudStorageApp = {
  configured: boolean
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
