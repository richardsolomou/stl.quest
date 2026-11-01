import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net, { type LookupFunction } from 'node:net'
import type { Duplex } from 'node:stream'

const PRIVATE_NETWORKS = new net.BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const)
  PRIVATE_NETWORKS.addSubnet(address, prefix, 'ipv4')
for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  PRIVATE_NETWORKS.addSubnet(address, prefix, 'ipv6')

export class PrivateNetworkError extends Error {
  status = 400
  constructor(host: string) {
    super(`${host} does not resolve to a public internet address, which is all this server connects to`)
  }
}

// A name that does not exist fails like a private one, so the error cannot tell which internal names exist.
function lookupError(host: string, error: NodeJS.ErrnoException) {
  return error.code === 'ENOTFOUND' || error.code === 'ENODATA' ? new PrivateNetworkError(host) : error
}

/** True for addresses on the public internet; IPv4-mapped IPv6 addresses are checked as IPv4. */
export function publicAddress(address: string) {
  const version = net.isIP(address)
  return version !== 0 && !PRIVATE_NETWORKS.check(address, version === 4 ? 'ipv4' : 'ipv6')
}

/** Rejects endpoints whose host is a private literal address; hostnames are checked when the connection resolves them. */
export function assertPublicEndpoint(endpoint: string) {
  const host = new URL(endpoint).hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || (net.isIP(host) && !publicAddress(host))) throw new PrivateNetworkError(host)
}

/** Resolves a host to one public address to connect to, so the address checked is the address used. */
export async function resolvePublicAddress(host: string) {
  const addresses = net.isIP(host)
    ? [{ address: host }]
    : await dns.promises.lookup(host, { all: true }).catch((error: NodeJS.ErrnoException) => {
        throw lookupError(host, error)
      })
  if (addresses.length === 0 || addresses.some(({ address }) => !publicAddress(address))) throw new PrivateNetworkError(host)
  return addresses[0].address
}

// Checking every resolved address at connect time closes the DNS-rebinding gap a check before the request would leave.
const lookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(lookupError(hostname, error), '')
    if (addresses.length === 0 || addresses.some(({ address }) => !publicAddress(address)))
      return callback(new PrivateNetworkError(hostname), '')
    if (options.all) return callback(null, addresses)
    callback(null, addresses[0].address, addresses[0].family)
  })
}

// Node skips `lookup` for literal addresses, which a redirect can introduce after the endpoint check.
function literalAddressError(host: string | null | undefined) {
  const address = host?.replace(/^\[|\]$/g, '') ?? ''
  return net.isIP(address) && !publicAddress(address) ? new PrivateNetworkError(address) : undefined
}

class GuardedHttpAgent extends http.Agent {
  override createConnection(options: http.ClientRequestArgs, callback?: (error: Error | null, stream: Duplex) => void) {
    const error = literalAddressError(options.host)
    if (!error) return super.createConnection(options, callback)
    callback?.(error, undefined as never)
    return undefined
  }
}

class GuardedHttpsAgent extends https.Agent {
  override createConnection(options: https.RequestOptions, callback?: (error: Error | null, stream: Duplex) => void) {
    const error = literalAddressError(options.host)
    if (!error) return super.createConnection(options, callback)
    callback?.(error, undefined as never)
    return undefined
  }
}

/** HTTP agents that refuse to connect to private networks, for endpoints a hosted workspace supplies. */
export function guardedAgents() {
  // Each store gets its own agents and nothing destroys them, so idle sockets must close on their own, as with Node's global agent.
  const options = { lookup, keepAlive: true, maxSockets: 50, timeout: 5_000 }
  return { httpAgent: new GuardedHttpAgent(options), httpsAgent: new GuardedHttpsAgent(options) }
}

export type OutboundAgents = ReturnType<typeof guardedAgents>
