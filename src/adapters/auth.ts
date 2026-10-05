import {
  SOCIAL_AUTH_PROVIDERS,
  normalizeOidcIssuer,
  oidcDisplayName,
  parseOidcScopes,
  type AuthAdapterConfig,
  type IntegrationConfig,
  type OidcProviderConfig,
  type SocialAuthProvider,
  type SocialProviderConfig,
  type SocialProviderConfigs,
} from '../core/auth'
import { providerCredentials } from 'ras-stack/auth'
import { environmentFlag } from './environment'

function environmentProvider(provider: SocialAuthProvider, environment: NodeJS.ProcessEnv): SocialProviderConfig | undefined {
  const credentials = providerCredentials(provider, environment, { prefix: 'AUTH_' })
  if (!credentials) return undefined
  const enabled = environmentFlag(environment[`AUTH_${provider.toUpperCase()}_ENABLED`], true)
  return { enabled, ...credentials }
}

function environmentOidcProvider(environment: NodeJS.ProcessEnv): OidcProviderConfig | undefined {
  const provider = environmentProvider('oidc', environment)
  if (!provider) return undefined
  const issuer = normalizeOidcIssuer(environment.AUTH_OIDC_ISSUER ?? '')
  if (!issuer) throw new Error('AUTH_OIDC_ISSUER must be an http or https URL when OIDC credentials are configured')
  return { ...provider, issuer, scopes: parseOidcScopes(environment.AUTH_OIDC_SCOPES), name: oidcDisplayName(environment.AUTH_OIDC_NAME) }
}

export function resolveAuthAdapterConfig(stored?: IntegrationConfig, environment: NodeJS.ProcessEnv = process.env): AuthAdapterConfig {
  const providers: SocialProviderConfigs = {
    google: environmentProvider('google', environment) ?? stored?.google,
    discord: environmentProvider('discord', environment) ?? stored?.discord,
    oidc: environmentOidcProvider(environment) ?? stored?.oidc,
  }
  const recovery = environmentFlag(environment.AUTH_PASSWORD_RECOVERY)
  const password = recovery || environmentFlag(environment.AUTH_PASSWORD_ENABLED, stored?.passwordEnabled ?? true)
  const socialProviders = SOCIAL_AUTH_PROVIDERS.filter((provider) => providers[provider]?.enabled)
  if (!password && socialProviders.length === 0)
    throw new Error('password authentication cannot be disabled until at least one social provider is enabled')
  return { password, passwordReset: password, socialProviders, ...(providers.oidc ? { oidcName: providers.oidc.name } : {}), ...providers }
}
