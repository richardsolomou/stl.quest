export type SignInFailureReason = 'invalid_credentials' | 'rate_limited' | 'error'
export type AuthCallbackFailureReason =
  | 'cancelled'
  | 'account_already_linked'
  | 'account_not_linked'
  | 'email_mismatch'
  | 'invalid_token'
  | 'token_expired'
  | 'error'

/** Why an email sign-in failed, from the error a Better Auth client call returned or threw. */
export function classifySignInFailure(failure: unknown): SignInFailureReason {
  if (!failure || typeof failure !== 'object') return 'error'
  const status = 'status' in failure ? failure.status : undefined
  const code = 'code' in failure ? failure.code : undefined
  // A rate-limited attempt can still carry the credential code of the attempt before it.
  if (status === 429) return 'rate_limited'
  if (status === 401 || code === 'INVALID_EMAIL_OR_PASSWORD') return 'invalid_credentials'
  return 'error'
}

/** Why an OAuth, verification, or reset link came back with `?error=`, from the codes Better Auth 1.7 and providers send. */
export function classifyAuthCallbackFailure(error: unknown): AuthCallbackFailureReason {
  if (typeof error !== 'string') return 'error'
  switch (error.trim().toLowerCase()) {
    case 'access_denied':
    // Apple's code for a cancelled sign-in, which the callback forwards unchanged.
    case 'user_cancelled_authorize':
      return 'cancelled'
    case 'account_not_linked':
    case 'unable_to_link_account':
      return 'account_not_linked'
    case 'email_does_not_match':
      return 'email_mismatch'
    case 'account_already_linked_to_different_user':
    case 'social_account_already_linked':
      return 'account_already_linked'
    case 'invalid_token':
      return 'invalid_token'
    case 'token_expired':
      return 'token_expired'
    default:
      return 'error'
  }
}

/** Better Auth's own message for a failure, or `fallback` when it has none. */
export function authFailureMessage(failure: unknown, fallback: string) {
  if (!failure || typeof failure !== 'object' || !('message' in failure)) return fallback
  return typeof failure.message === 'string' && failure.message.trim() ? failure.message : fallback
}
