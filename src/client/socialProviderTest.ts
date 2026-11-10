import type { Messages } from '../core/i18n'
import type { SocialAuthProvider } from '../core/auth'
import { authClient } from './authClient'

export function socialProviderTestResult(search: string, provider: SocialAuthProvider) {
  const params = new URLSearchParams(search)
  if (params.get('authTest') !== provider) return undefined
  return params.get('authTestFailed') === 'true' || params.has('error') ? 'failed' : 'returned'
}

export function socialProviderTestErrorCode(search: string, provider: SocialAuthProvider) {
  if (socialProviderTestResult(search, provider) !== 'failed') return undefined
  const code = new URLSearchParams(search).get('error')
  return code && /^[a-z0-9_]{1,100}$/i.test(code) ? code : undefined
}

export function socialProviderTestFailure(search: string, provider: SocialAuthProvider, copy: Messages['settings']['signIn']['provider']) {
  if (socialProviderTestResult(search, provider) !== 'failed') return undefined
  const code = socialProviderTestErrorCode(search, provider)
  switch (code) {
    case 'unable_to_link_account':
      return copy.testErrors.linking
    case 'email_not_found':
      return copy.testErrors.emailMissing
    case 'email_not_verified':
      return copy.testErrors.emailUnverified
    case 'account_already_linked_to_different_user':
      return copy.testErrors.alreadyLinked
    case 'access_denied':
      return copy.testErrors.consent
    case 'invalid_code':
    case 'state_mismatch':
    case 'state_not_found':
    case 'no_code':
      return copy.testErrors.expired
    case 'issuer_missing':
    case 'issuer_mismatch':
    case 'nonce_binding_missing':
    case 'unable_to_get_user_info':
      return copy.testErrors.profile
    case 'oauth_provider_not_found':
      return copy.testErrors.unavailable
    default:
      return copy.testFailed
  }
}

export async function startSocialProviderTest(provider: SocialAuthProvider, fallback: string) {
  const callbackURL = `/admin/integrations?authTest=${provider}`
  const { error } = await authClient.linkSocial({
    provider,
    callbackURL,
    errorCallbackURL: `${callbackURL}&authTestFailed=true`,
  })
  if (error) throw new Error(error.message || fallback)
}
