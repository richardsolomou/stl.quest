import { SOCIAL_AUTH_PROVIDER_NAMES, SOCIAL_AUTH_PROVIDERS, type SocialAuthProvider } from '../core/auth'

export const SOCIAL_PROVIDER_SETTINGS = {
  google: {
    name: SOCIAL_AUTH_PROVIDER_NAMES.google,
    description: 'Sign in with a Google account.',
    consoleName: 'Google Auth Platform',
    consoleUrl: 'https://console.cloud.google.com/auth/clients',
    showOrigin: true,
    steps: [
      'Select or create a Google Cloud project, then configure its Branding and Audience screens.',
      'Open Clients and create an OAuth client with the application type Web application.',
      'Add the STL Quest URL below to Authorized JavaScript origins.',
      'Add the callback URL below to Authorized redirect URIs exactly as shown.',
      'Copy the generated client ID and client secret into STL Quest.',
    ],
  },
  discord: {
    name: SOCIAL_AUTH_PROVIDER_NAMES.discord,
    description: 'Sign in with a Discord account.',
    consoleName: 'Discord Developer Portal',
    consoleUrl: 'https://discord.com/developers/applications',
    showOrigin: false,
    steps: [
      'Create or select a Discord application, then open its OAuth2 settings.',
      'Add the callback URL below under Redirects and save the change.',
      'Copy the client ID, then reset and copy the client secret into STL Quest.',
    ],
  },
  oidc: {
    name: 'OpenID Connect',
    description: 'Sign in through your own identity provider, such as Authentik, Keycloak, or Microsoft Entra ID.',
    consoleName: 'your identity provider',
    showOrigin: false,
    steps: [
      'In your identity provider, create an OAuth2 or OpenID Connect application with a confidential client.',
      'Add the callback URL below as the redirect URI exactly as shown.',
      'Make sure the provider sends the email claim. Invites match accounts by email.',
      'Copy the issuer URL, client ID, and client secret into STL Quest.',
    ],
  },
} as const satisfies Record<
  SocialAuthProvider,
  {
    name: string
    description: string
    consoleName: string
    consoleUrl?: string
    showOrigin: boolean
    steps: readonly string[]
  }
>

export const SOCIAL_PROVIDER_OPTIONS = SOCIAL_AUTH_PROVIDERS.map((id) => ({ id, ...SOCIAL_PROVIDER_SETTINGS[id] }))
