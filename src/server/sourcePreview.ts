import { COVER_WIDTH, imageContentType, MAX_COVER_BYTES } from '../core/coverImage'
import { readLimitedBody } from './readLimitedBody'

// MakerWorld returns every print profile with a model, so one with many profiles runs to several megabytes.
const MAX_METADATA_BYTES = 8 * 1024 * 1024
// A JSON string value, escapes included, so the field can be read without parsing the rest of the document.
const JSON_STRING = String.raw`"((?:[^"\\]|\\.)*)"`
// Printables only renders a fixed set of boxes; this is the one its model gallery shows.
const PRINTABLES_RENDITION = 'thumbs/inside/1600x1200'
const MAX_REDIRECTS = 3

type SourceProvider = {
  /** Page hosts this provider claims, matched against the parsed hostname with an optional `www.` prefix. */
  hosts: string[]
  /** CDN hosts whose images the proxy will fetch. Nothing outside this list is ever requested. */
  imageHosts: string[]
  resolve: (url: URL, request: typeof fetch) => Promise<string | undefined>
  /** Rewrites a trusted cover URL to a smaller rendition, so a large original still fits under `MAX_COVER_BYTES`. */
  sized?: (image: URL) => URL
}

// Model pages sit behind bot protection that rejects server-side requests, so covers come from public JSON APIs.
// Thingiverse, Cults3D, MyMiniFactory, and Thangs answer every server request, API and oEmbed alike, with a
// challenge page, so links to them have no cover until someone supplies one.
const PROVIDERS: SourceProvider[] = [
  {
    hosts: ['makerworld.com'],
    imageHosts: ['makerworld.bblmw.com', 'public-cdn.bblmw.com', 'public-cdn.bambulab.com'],
    // MakerWorld covers are often several megabytes. The bblmw.com CDN is Alibaba OSS, which resizes on request.
    sized: (image) => {
      if (image.hostname.endsWith('.bblmw.com')) image.searchParams.set('x-oss-process', `image/resize,w_${COVER_WIDTH}`)
      return image
    },
    resolve: async (url, request) => {
      const modelId = url.pathname.match(/(?:^|\/)models\/(\d+)(?:[-/]|$)/)?.[1]
      if (!modelId) return undefined
      const response = await request(`https://api.bambulab.com/v1/design-service/design/${modelId}`, {
        redirect: 'error',
        signal: AbortSignal.timeout(5_000),
        headers: { accept: 'application/json' },
      })
      if (!response.ok) return undefined
      return await readJsonStringField(response, 'coverUrl', MAX_METADATA_BYTES)
    },
  },
  {
    hosts: ['printables.com'],
    imageHosts: ['media.printables.com'],
    // Originals are often several megabytes; renditions sit beside them as thumbs/<box>/<original extension>/<name>.webp.
    sized: (image) => {
      const original = image.pathname.match(/^(.*\/)([^/]+)\.([^./]+)$/)
      if (original) image.pathname = `${original[1]}${PRINTABLES_RENDITION}/${original[3]}/${original[2]}.webp`
      return image
    },
    resolve: async (url, request) => {
      const modelId = url.pathname.match(/(?:^|\/)model\/(\d+)(?:[-/]|$)/)?.[1]
      if (!modelId) return undefined
      const metadata = await readJson(request, 'https://api.printables.com/graphql/', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          query: 'query PrintCover($id: ID!) { print(id: $id) { image { filePath } } }',
          variables: { id: modelId },
        }),
      })
      const filePath = (metadata?.data as { print?: { image?: { filePath?: unknown } } } | undefined)?.print?.image?.filePath
      return typeof filePath === 'string' && filePath ? new URL(filePath, 'https://media.printables.com/').toString() : undefined
    },
  },
]

function matchesHost(hostname: string, hosts: string[]) {
  return hosts.some((host) => hostname === host || hostname === `www.${host}`)
}

const IMAGE_HOSTS = new Set(PROVIDERS.flatMap((provider) => provider.imageHosts))

export async function resolveSourceImage(source: string, request: typeof fetch = fetch) {
  let sourceUrl: URL
  try {
    sourceUrl = new URL(source)
  } catch {
    return undefined
  }
  if (sourceUrl.protocol !== 'https:') return undefined
  const hostname = sourceUrl.hostname.toLowerCase()
  const provider = PROVIDERS.find(({ hosts }) => matchesHost(hostname, hosts))
  if (!provider) return undefined
  try {
    const image = await provider.resolve(sourceUrl, request)
    // A provider may legitimately point at a CDN we do not proxy; drop it rather than widen the allowlist.
    return image !== undefined && validSourceImageUrl(image) ? image : undefined
  } catch {
    return undefined
  }
}

export async function loadSourceImage(source: string, request: typeof fetch = fetch) {
  if (!validSourceImageUrl(source)) throw new Response('invalid source image', { status: 400, statusText: 'untrusted source image url' })
  const sized = sizedSourceImageUrl(source)
  let response = await fetchImage(request, sized)
  // A CDN may have no rendition of an original it never processed, so the original is the fallback.
  if (response && !response.ok && sized !== source) {
    await response.body?.cancel().catch(() => {})
    response = await fetchImage(request, source)
  }
  if (!response) throw new Response('source image unavailable', { status: 502, statusText: 'source redirect refused' })
  if (!response.ok) throw new Response('source image unavailable', { status: 502, statusText: `source returned ${response.status}` })
  const bytes = await readBounded(response, MAX_COVER_BYTES)
  const contentType = imageContentType(bytes)
  if (!contentType) throw new Response('invalid source image', { status: 502, statusText: 'source is not an image' })
  return { bytes, contentType }
}

/** Thrown responses serialize as `{}` in logs, so their status and reason are logged as fields instead. */
export function sourceImageFailure(error: unknown) {
  if (error instanceof Response) return { status: error.status, details: { status: error.status, reason: error.statusText } }
  return { status: 502, details: { err: error } }
}

function fetchImage(request: typeof fetch, url: string) {
  return fetchWithin(request, url, {
    signal: AbortSignal.timeout(5_000),
    headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' },
  })
}

function sizedSourceImageUrl(source: string) {
  const url = new URL(source)
  const provider = PROVIDERS.find(({ imageHosts }) => imageHosts.includes(url.hostname.toLowerCase()))
  return (provider?.sized?.(url) ?? url).toString()
}

function validSourceImageUrl(source: string) {
  try {
    const url = new URL(source)
    return url.protocol === 'https:' && IMAGE_HOSTS.has(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

async function readJson(request: typeof fetch, url: string, init?: RequestInit) {
  const response = await request(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(5_000),
    headers: { accept: 'application/json' },
    ...init,
  })
  if (!response.ok) return undefined
  const bytes = await readBounded(response, MAX_METADATA_BYTES)
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown> | undefined
}

// Every redirect hop is re-checked against the image allowlist, which `redirect: 'follow'` would not do.
async function fetchWithin(request: typeof fetch, url: string, init: RequestInit) {
  let target = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await request(target, { ...init, redirect: 'manual' })
    if (response.status < 300 || response.status >= 400) return response
    const location = response.headers.get('location')
    await response.body?.cancel().catch(() => {})
    if (!location) return undefined
    const next = new URL(location, target)
    if (next.protocol !== 'https:' || !validSourceImageUrl(next.toString())) return undefined
    target = next.toString()
  }
  return undefined
}

/**
 * Reads a body only until the first `field` string appears, then stops. MakerWorld puts `coverUrl` in the first few
 * hundred bytes of a document that can run to megabytes, and its API sometimes stalls partway through sending one.
 */
async function readJsonStringField(response: Response, field: string, limit: number) {
  if (!response.body) return undefined
  const pattern = new RegExp(`"${field}"\\s*:\\s*${JSON_STRING}`, 'g')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  try {
    while (text.length < limit) {
      const { done, value } = await reader.read()
      if (done) return undefined
      // Rescanning only the end of the text keeps a long document linear; no cover URL is anywhere near this long.
      pattern.lastIndex = Math.max(0, text.length - 4096)
      text = (text + decoder.decode(value, { stream: true })).slice(0, limit)
      const match = pattern.exec(text)
      if (match) return JSON.parse(`"${match[1]}"`) as string
    }
    return undefined
  } finally {
    await reader.cancel().catch(() => {})
  }
}

async function readBounded(response: Response, limit: number) {
  const bytes = await readLimitedBody(response, limit)
  if (!bytes) throw new Response('source preview is too large', { status: 413, statusText: 'source image is too large' })
  return bytes
}
