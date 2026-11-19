import https from 'node:https'
import { setTimeout as delay } from 'node:timers/promises'
import pRetry from 'p-retry'

const lastRequestAt = new Map<string, number>()

async function paceHost(hostname: string) {
  const wait = (lastRequestAt.get(hostname) ?? 0) + 1000 - Date.now()
  if (wait > 0) await delay(wait)
  lastRequestAt.set(hostname, Date.now())
}

export function fetchWithRetry(url: string) {
  return pRetry(
    async () => {
      await paceHost(new URL(url).hostname)
      const response = await httpsGet(url)
      if (response.status === 429) await delay(Math.min(Number(response.headers.get('retry-after')) || 5, 120) * 1000)
      if (response.status === 429 || response.status >= 500) throw new Error(`${url} returned ${response.status}`)
      return response
    },
    { retries: 3, minTimeout: 500 },
  )
}

// Shopify storefronts answer Node's fetch() with 429 but accept a plain request carrying only these headers.
function httpsGet(url: string, redirects = 5): Promise<Response> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: requestHeaders(url) }, (response) => {
        const status = response.statusCode ?? 0
        if (status >= 300 && status < 400 && response.headers.location && redirects > 0) {
          response.resume()
          resolve(httpsGet(new URL(response.headers.location, url).href, redirects - 1))
          return
        }
        const chunks: Buffer[] = []
        response
          .on('data', (chunk: Buffer) => chunks.push(chunk))
          .on('end', () => {
            const headers = new Headers()
            for (const [name, value] of Object.entries(response.headers)) if (typeof value === 'string') headers.set(name, value)
            resolve(new Response(Buffer.concat(chunks), { status, headers }))
          })
          .on('error', reject)
      })
      .on('error', reject)
  })
}

function requestHeaders(url: string) {
  const headers: Record<string, string> = { accept: '*/*', 'user-agent': 'STL Quest catalog sync' }
  const token = process.env.GITHUB_TOKEN
  if (token && new URL(url).hostname === 'api.github.com') headers.authorization = `Bearer ${token}`
  return headers
}
