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
import { environmentFlag, environmentFlagSet } from './environment'

// A provider with only one of its credentials throws, so a typo cannot hide its button.
function environmentProvider(provider: SocialAuthProvider, environment: NodeJS.ProcessEnv): SocialProviderConfig | undefined {
  const name = `AUTH_${provider.toUpperCase()}`
  const clientId = environment[`${name}_CLIENT_ID`]?.trim()
  const clientSecret = environment[`${name}_CLIENT_SECRET`]?.trim()
  if (Boolean(clientId) !== Boolean(clientSecret))
    throw new Error(`${name}_CLIENT_ID and ${name}_CLIENT_SECRET must be configured together`)
  if (!clientId || !clientSecret) return undefined
  return { enabled: environmentFlag(environment[`${name}_ENABLED`], true), clientId, clientSecret }
}

function environmentOidcProvider(environment: NodeJS.ProcessEnv): OidcProviderConfig | undefined {
  const provider = environmentProvider('oidc', environment)
  if (!provider) return undefined
  const issuer = normalizeOidcIssuer(environment.AUTH_OIDC_ISSUER ?? '')
  if (!issuer) throw new Error('AUTH_OIDC_ISSUER must be an http or https URL when OIDC credentials are configured')
  return { ...provider, issuer, scopes: parseOidcScopes(environment.AUTH_OIDC_SCOPES), name: oidcDisplayName(environment.AUTH_OIDC_NAME) }
}

export function resolveAuthAdapterConfig(stored?: IntegrationConfig, environment: NodeJS.ProcessEnv = process.env): AuthAdapterConfig {
  const environmentOidc = environmentOidcProvider(environment)
  const providers: SocialProviderConfigs = {
    google: environmentProvider('google', environment) ?? stored?.google,
    discord: environmentProvider('discord', environment) ?? stored?.discord,
    oidc: environmentOidc ?? stored?.oidc,
  }
  const recovery = environmentFlag(environment.AUTH_PASSWORD_RECOVERY)
  const password = recovery || environmentFlag(environment.AUTH_PASSWORD_ENABLED, stored?.passwordEnabled ?? true)
  const socialProviders = SOCIAL_AUTH_PROVIDERS.filter((provider) => providers[provider]?.enabled)
  if (!password && socialProviders.length === 0)
    throw new Error('password authentication cannot be disabled until at least one social provider is enabled')
  return {
    password,
    passwordReset: password,
    socialProviders,
    oidcName: providers.oidc?.name,
    // An environment-configured provider ignores the stored setting, which the UI can no longer change.
    oidcAllowSignup: environmentFlag(environment.AUTH_OIDC_ALLOW_SIGNUP, (environmentOidc ? undefined : stored?.oidc?.allowSignup) ?? true),
    oidcAllowSignupSource: environmentFlagSet(environment.AUTH_OIDC_ALLOW_SIGNUP) ? 'environment' : 'database',
    ...providers,
  }
}
