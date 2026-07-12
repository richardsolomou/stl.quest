import { validSameOriginRequest } from './sameOrigin'

export class UploadRequestLimiter {
  private total = 0
  private owners = new Map<string, number>()

  constructor(
    private maxTotal = 4,
    private maxPerOwner = 2,
  ) {}

  enter(owner: string) {
    const owned = this.owners.get(owner) ?? 0
    if (this.total >= this.maxTotal || owned >= this.maxPerOwner) return undefined
    this.total++
    this.owners.set(owner, owned + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      this.total--
      const remaining = (this.owners.get(owner) ?? 1) - 1
      if (remaining) this.owners.set(owner, remaining)
      else this.owners.delete(owner)
    }
  }
}

export function validSameOrigin(request: Request) {
  return validSameOriginRequest(request, request.method === 'HEAD')
}
