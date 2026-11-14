import { authClient } from './authClient'

type SocialSignInOptions = Parameters<typeof authClient.signIn.social>[0]

/** OAuth callbacks return machine-readable errors; public screens only use their presence. */
export function hasSocialSignInError(search: string) {
  return new URLSearchParams(search).has('error')
}

/** Keep provider diagnostics out of the public form; only expose a short machine-readable error code. */
export function socialSignInErrorCode(search: string) {
  const code = new URLSearchParams(search).get('error')
  return code && /^[a-z0-9_]{1,100}$/i.test(code) ? code : undefined
}

/** Starts the provider redirect. A network failure throws instead of returning an error, so both mean the redirect did not start. */
export async function startSocialSignIn(options: SocialSignInOptions): Promise<boolean> {
  try {
    const { error } = await authClient.signIn.social(options)
    return !error
  } catch {
    return false
  }
}
