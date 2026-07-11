import { ConvexHttpClient } from 'convex/browser'

let client: ConvexHttpClient | undefined

export function convex(): ConvexHttpClient {
  if (!client) {
    const url = process.env.CONVEX_URL ?? (import.meta.env.VITE_CONVEX_URL as string)
    if (!url) throw new Error('CONVEX_URL is not set')
    client = new ConvexHttpClient(url)
  }
  return client
}

export function writeSecret(): string {
  const secret = process.env.CONVEX_ACTION_SECRET
  if (!secret) throw new Error('CONVEX_ACTION_SECRET is not set')
  return secret
}
