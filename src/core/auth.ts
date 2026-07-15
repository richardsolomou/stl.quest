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

export type IntegrationConfig = {
  passwordEnabled: boolean
  google?: SocialProviderConfig
  discord?: SocialProviderConfig
  smtp?: SmtpEmailConfig
  /** Alternate persisted shapes accepted during settings normalization. */
  socialSignUpEnabled?: boolean
  email?: ({ adapter: 'smtp' } & Omit<SmtpEmailConfig, 'testedAt'>) | { adapter: string; [key: string]: unknown }
  emailTestedAt?: number
  emails?: Array<{ adapter: string; enabled: boolean; testedAt?: number; [key: string]: unknown }>
}

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
  smtp: PublicSmtpConfig
}
