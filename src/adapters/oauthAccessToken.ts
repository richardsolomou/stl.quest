export type OAuthAccessToken = { value: string; expiresInSeconds: number }

type OAuthTokenResponse = { access_token: string; expires_in: number; refresh_token?: string }

export async function refreshOAuthAccessToken(
  url: string,
  options: {
    parameters: Record<string, string>
    headers?: Record<string, string>
    fetch: (url: string, init: RequestInit) => Promise<Response>
    error: (response: Response) => Promise<Error>
  },
) {
  const response = await options.fetch(url, {
    method: 'POST',
    headers: { ...options.headers, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(options.parameters),
  })
  if (!response.ok) throw await options.error(response)
  const token = (await response.json()) as OAuthTokenResponse
  return { value: token.access_token, expiresInSeconds: token.expires_in, refreshToken: token.refresh_token }
}

export class OAuthAccessTokenCache {
  private current?: { value: string; expiresAt: number }
  private refreshing?: Promise<string>

  get(refresh: () => Promise<OAuthAccessToken>) {
    if (this.current && this.current.expiresAt > Date.now()) return Promise.resolve(this.current.value)
    this.refreshing ??= refresh()
      .then(({ value, expiresInSeconds }) => {
        this.current = { value, expiresAt: Date.now() + Math.max(expiresInSeconds - 60, 1) * 1_000 }
        return value
      })
      .finally(() => {
        this.refreshing = undefined
      })
    return this.refreshing
  }
}
