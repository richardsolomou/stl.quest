const MAX_METADATA_BYTES = 1024 * 1024
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
// Model sites canonicalise pasted URLs (locale prefixes, renamed categories), so a few hops are
// followed by hand. Every hop is re-checked against the allowlist, which `redirect: 'follow'` would not do.
const MAX_REDIRECTS = 3

type SourceProvider = {
  /** Page hosts this provider claims, matched against the parsed hostname with an optional `www.` prefix. */
  hosts: string[]
  /** CDN hosts whose images the proxy will fetch. Nothing outside this list is ever requested. */
  imageHosts: string[]
  resolve: (url: URL, request: typeof fetch) => Promise<string | undefined>
}

// MakerWorld and Printables sit behind bot protection that rejects server-side HTML requests,
// so those providers read a public JSON API instead of the page's OpenGraph tags.
const PROVIDERS: SourceProvider[] = [
  {
    hosts: ['makerworld.com'],
    imageHosts: ['makerworld.bblmw.com', 'public-cdn.bblmw.com', 'public-cdn.bambulab.com'],
    resolve: async (url, request) => {
      const modelId = url.pathname.match(/(?:^|\/)models\/(\d+)(?:[-/]|$)/)?.[1]
      if (!modelId) return undefined
      const metadata = await readJson(request, `https://api.bambulab.com/v1/design-service/design/${modelId}`)
      return typeof metadata?.coverUrl === 'string' ? metadata.coverUrl : undefined
    },
  },
  {
    hosts: ['printables.com'],
    imageHosts: ['media.printables.com'],
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
  openGraphProvider(['myminifactory.com'], ['dl.myminifactory.com', 'cdn.myminifactory.com', 'images.myminifactory.com']),
  openGraphProvider(['cults3d.com'], ['images.cults3d.com', 'fbi.cults3d.com']),
  openGraphProvider(['thingiverse.com'], ['resize.thingiverse.com', 'cdn.thingiverse.com', 'media.thingiverse.com']),
]

function openGraphProvider(hosts: string[], imageHosts: string[]): SourceProvider {
  return { hosts, imageHosts, resolve: (url, request) => readOpenGraphImage(request, url, hosts) }
}

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
  if (!validSourceImageUrl(source)) throw new Response('invalid source image', { status: 400 })
  const response = await fetchWithin(request, source, {
    signal: AbortSignal.timeout(5_000),
    headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' },
  })
  if (!response?.ok) throw new Response('source image unavailable', { status: 502 })
  const bytes = await readBounded(response, MAX_IMAGE_BYTES)
  const contentType = sourceImageContentType(bytes)
  if (!contentType) throw new Response('invalid source image', { status: 502 })
  return { bytes, contentType }
}

export function validSourceImageUrl(source: string) {
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
    signal: AbortSignal.timeout(3_000),
    headers: { accept: 'application/json' },
    ...init,
  })
  if (!response.ok) return undefined
  const bytes = await readBounded(response, MAX_METADATA_BYTES)
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown> | undefined
}

async function readOpenGraphImage(request: typeof fetch, url: URL, hosts: string[]) {
  const response = await fetchWithin(
    request,
    url.toString(),
    { signal: AbortSignal.timeout(5_000), headers: { accept: 'text/html' } },
    (candidate) => matchesHost(candidate.hostname.toLowerCase(), hosts),
  )
  if (!response?.ok) return undefined
  // Meta tags live in <head>, so a long page body is truncated rather than treated as a failure.
  return openGraphImage(new TextDecoder().decode(await readTruncated(response, MAX_METADATA_BYTES)))
}

async function fetchWithin(
  request: typeof fetch,
  url: string,
  init: RequestInit,
  allowed: (candidate: URL) => boolean = (candidate) => validSourceImageUrl(candidate.toString()),
) {
  let target = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await request(target, { ...init, redirect: 'manual' })
    if (response.status < 300 || response.status >= 400) return response
    const location = response.headers.get('location')
    await response.body?.cancel().catch(() => {})
    if (!location) return undefined
    const next = new URL(location, target)
    if (next.protocol !== 'https:' || !allowed(next)) return undefined
    target = next.toString()
  }
  return undefined
}

async function readTruncated(response: Response, limit: number) {
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (size < limit) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.byteLength
  }
  await reader.cancel().catch(() => {})
  return concat(chunks, size)
}

/** Reads the first `og:image` (or `twitter:image`) content value, tolerating either attribute order. */
export function openGraphImage(html: string) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!/\b(?:property|name)\s*=\s*["']?(?:og:image|twitter:image)(?::url)?["'\s>]/i.test(tag)) continue
    const content = tag.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i)
    const value = content?.[1] ?? content?.[2]
    if (value) return decodeHtmlEntities(value.trim())
  }
  return undefined
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&(?:amp|#38|#x26);/gi, '&')
    .replace(/&(?:quot|#34|#x22);/gi, '"')
    .replace(/&(?:#39|#x27|apos);/gi, "'")
}

async function readBounded(response: Response, limit: number) {
  const declaredSize = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredSize) && declaredSize > limit) throw new Response('source preview is too large', { status: 413 })
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      throw new Response('source preview is too large', { status: 413 })
    }
    chunks.push(value)
  }
  return concat(chunks, size)
}

function concat(chunks: Uint8Array[], size: number) {
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export function sourceImageContentType(bytes: Uint8Array) {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (new TextDecoder().decode(bytes.subarray(0, 6)).match(/^GIF8[79]a$/)) return 'image/gif'
  if (new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP') {
    return 'image/webp'
  }
  const boxType = new TextDecoder().decode(bytes.subarray(4, 12))
  if (boxType === 'ftypavif' || boxType === 'ftypavis') return 'image/avif'
  return undefined
}

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value)
}
