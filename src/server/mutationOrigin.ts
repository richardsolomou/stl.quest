import { requireTanStackMutationOrigin } from 'ras-stack/tanstack/server'
import { originOptions } from './sameOrigin'

export function requireMutationOrigin(request?: Request) {
  requireTanStackMutationOrigin(originOptions(), request)
}
