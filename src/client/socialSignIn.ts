import { authClient } from './authClient'

type SocialSignInOptions = Parameters<typeof authClient.signIn.social>[0]

/** Starts the provider redirect. A network failure throws instead of returning an error, so both mean the redirect did not start. */
export async function startSocialSignIn(options: SocialSignInOptions): Promise<boolean> {
  try {
    const { error } = await authClient.signIn.social(options)
    return !error
  } catch {
    return false
  }
}
