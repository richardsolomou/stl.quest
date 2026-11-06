import { SOCIAL_AUTH_PROVIDER_NAMES, SOCIAL_AUTH_PROVIDERS, type SocialAuthProvider } from '../core/auth'

/** Setup copy (description, console name, steps) lives in `t.settings.socialProviders`. */
export const SOCIAL_PROVIDER_SETTINGS = {
  google: {
    name: SOCIAL_AUTH_PROVIDER_NAMES.google,
    consoleUrl: 'https://console.cloud.google.com/auth/clients',
    showOrigin: true,
  },
  discord: {
    name: SOCIAL_AUTH_PROVIDER_NAMES.discord,
    consoleUrl: 'https://discord.com/developers/applications',
    showOrigin: false,
  },
  oidc: {
    name: 'OpenID Connect',
    showOrigin: false,
  },
} as const satisfies Record<SocialAuthProvider, { name: string; consoleUrl?: string; showOrigin: boolean }>

export const SOCIAL_PROVIDER_OPTIONS = SOCIAL_AUTH_PROVIDERS.map((id) => ({ id, ...SOCIAL_PROVIDER_SETTINGS[id] }))
