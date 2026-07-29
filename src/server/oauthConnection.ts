import { cloudFetch } from '../adapters/cloudFetch'
import type { CloudStorageApp } from '../core/auth'

export async function exchangeOAuthAuthorizationCode(options: {
  url: string
  provider: string
  app: CloudStorageApp
  code: string
  redirectUri: string
  parameters?: Record<string, string>
}) {
  const response = await cloudFetch(options.url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: options.app.clientId,
      client_secret: options.app.clientSecret,
      code: options.code,
      grant_type: 'authorization_code',
      redirect_uri: options.redirectUri,
      ...options.parameters,
    }),
  })
  if (!response.ok) throw new Response(`${options.provider} token exchange failed: ${await response.text()}`, { status: 502 })
  return (await response.json()) as { access_token: string; refresh_token?: string }
}

export async function fetchOAuthProfile<Profile>(url: string, accessToken: string, provider: string) {
  const response = await cloudFetch(url, { headers: { authorization: `Bearer ${accessToken}` } })
  if (!response.ok) throw new Response(`${provider} account lookup failed: ${await response.text()}`, { status: 502 })
  return (await response.json()) as Profile
}
