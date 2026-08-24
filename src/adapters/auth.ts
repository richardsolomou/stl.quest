import {
  SOCIAL_AUTH_PROVIDERS,
  type AuthAdapterConfig,
  type IntegrationConfig,
  type SocialAuthProvider,
  type SocialProviderConfig,
} from '../core/auth'
import { providerCredentials } from 'ras-stack/auth'
import { environmentFlag } from './environment'

function environmentProvider(provider: SocialAuthProvider, environment: NodeJS.ProcessEnv): SocialProviderConfig | undefined {
  const credentials = providerCredentials(provider, environment, { prefix: 'AUTH_', rejectPartial: true })
  if (!credentials) return undefined
  const enabled = environmentFlag(environment[`AUTH_${provider.toUpperCase()}_ENABLED`], true)
  return { enabled, ...credentials }
}

export function resolveAuthAdapterConfig(stored?: IntegrationConfig, environment: NodeJS.ProcessEnv = process.env): AuthAdapterConfig {
  const providers = Object.fromEntries(
    SOCIAL_AUTH_PROVIDERS.map((provider) => [provider, environmentProvider(provider, environment) ?? stored?.[provider]]),
  ) as Partial<Record<SocialAuthProvider, SocialProviderConfig>>
  const recovery = environmentFlag(environment.AUTH_PASSWORD_RECOVERY)
  const password = recovery || environmentFlag(environment.AUTH_PASSWORD_ENABLED, stored?.passwordEnabled ?? true)
  const socialProviders = SOCIAL_AUTH_PROVIDERS.filter((provider) => providers[provider]?.enabled)
  if (!password && socialProviders.length === 0)
    throw new Error('password authentication cannot be disabled until at least one social provider is enabled')
  return { password, passwordReset: password, socialProviders, ...providers }
}
