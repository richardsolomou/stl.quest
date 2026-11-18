export type SignInFailureReason = 'invalid_credentials' | 'rate_limited' | 'error'

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
