export class ConnectionLimiter {
  private total = 0
  private identities = new Map<string, number>()

  constructor(
    private maxTotal = 100,
    private maxPerIdentity = 5,
  ) {}

  enter(identity: string) {
    const current = this.identities.get(identity) ?? 0
    if (this.total >= this.maxTotal || current >= this.maxPerIdentity) return undefined
    this.total++
    this.identities.set(identity, current + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      this.total--
      const remaining = (this.identities.get(identity) ?? 1) - 1
      if (remaining) this.identities.set(identity, remaining)
      else this.identities.delete(identity)
    }
  }
}
