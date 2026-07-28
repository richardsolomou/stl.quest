import crypto from 'node:crypto'

export type WorkLock = {
  lock(signal: AbortSignal, onLost: () => void): Promise<void>
  tryLock?(signal: AbortSignal, onLost: () => void): Promise<boolean>
  unlock(): Promise<void>
}

// Tracks per-key work in flight across replicas so an exclusive operation can wait for it to
// drain. Entries carry a deadline and are pruned by it, so a replica that dies mid-operation
// cannot block exclusive work forever. Lockers that omit this only coordinate in-process.
export type WorkRegistry = {
  register(entry: string, deadline: number): Promise<void>
  release(entry: string): Promise<void>
  activeCount(now: number): Promise<number>
}

export type WorkLocker = {
  newLock(id: string): WorkLock
  newRegistry?(id: string): WorkRegistry
}

export class WorkLeaseLost extends Error {}

export type WorkLease = {
  signal: AbortSignal
  release(): Promise<void>
}

export async function acquireWorkLease(locker: WorkLocker, id: string, wait: boolean): Promise<WorkLease | undefined> {
  const controller = new AbortController()
  const lock = locker.newLock(id)
  const onLost = () => controller.abort(new WorkLeaseLost(`distributed work lease lost: ${id}`))
  const acquired =
    wait || !lock.tryLock ? await lock.lock(controller.signal, onLost).then(() => true) : await lock.tryLock(controller.signal, onLost)
  if (!acquired) return undefined
  return { signal: controller.signal, release: async () => await lock.unlock() }
}

export async function withWorkLease<T>(locker: WorkLocker | undefined, id: string, operation: () => Promise<T>) {
  if (!locker) return await operation()
  const lease = await acquireWorkLease(locker, id, true)
  try {
    return await operation()
  } finally {
    await lease!.release()
  }
}

// How long a single per-key operation may run before an exclusive operation stops waiting for it.
// Publishing a 1 GB upload is the slow case, so this is generous.
const WORK_ENTRY_TTL = 30 * 60_000
const WORK_DRAIN_TIMEOUT = 30_000
const WORK_DRAIN_POLL = 100

/**
 * Shared/exclusive gate over one subject's work.
 *
 * Per-key operations run concurrently, serialized only against other work on the same key. An
 * exclusive operation runs alone: it holds the subject mutex for its whole duration, and entrants
 * must take that same mutex to register, so an exclusive operation is never starved by a stream of
 * per-key work. Both layers are enforced in-process and, when a locker is supplied, across replicas.
 */
export class WorkGate {
  private mutex = Promise.resolve()
  private keys = new Map<string, Promise<void>>()
  private active = 0
  private drained: (() => void) | undefined
  private readonly registry?: WorkRegistry

  constructor(
    private readonly id: string,
    private readonly locker?: WorkLocker,
    private readonly onDrainTimeout?: (active: number) => void,
  ) {
    this.registry = locker?.newRegistry?.(id)
  }

  async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    return await this.withSubjectMutex(async () => {
      await this.drain()
      return await operation()
    })
  }

  async perKey<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const entry = `${key}:${crypto.randomUUID()}`
    // Claim the key while holding the subject mutex: once released, a waiting exclusive operation
    // can already see this work, and until then it cannot start at all.
    const claimed = await this.withSubjectMutex(async () => {
      this.active++
      await this.registry?.register(entry, Date.now() + WORK_ENTRY_TTL)
      return this.claimKey(key)
    })
    try {
      // Outside the subject mutex: waiting on same-key work must not block unrelated keys.
      await claimed.previous
      return await withWorkLease(this.locker, `${this.id}:${key}`, operation)
    } finally {
      claimed.release()
      await this.registry?.release(entry).catch(() => undefined)
      if (--this.active === 0) this.drained?.()
    }
  }

  private async withSubjectMutex<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutex
    let release!: () => void
    this.mutex = new Promise<void>((resolve) => (release = resolve))
    await previous
    try {
      return await withWorkLease(this.locker, this.id, operation)
    } finally {
      release()
    }
  }

  private claimKey(key: string) {
    const previous = this.keys.get(key) ?? Promise.resolve()
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    this.keys.set(key, held)
    return {
      release: () => {
        if (this.keys.get(key) === held) this.keys.delete(key)
        release()
      },
      previous,
    }
  }

  private async drain() {
    while (this.active > 0) await new Promise<void>((resolve) => (this.drained = resolve))
    if (!this.registry) return
    const deadline = Date.now() + WORK_DRAIN_TIMEOUT
    let active = await this.registry.activeCount(Date.now())
    while (active > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, WORK_DRAIN_POLL))
      active = await this.registry.activeCount(Date.now())
    }
    // Proceeding here can undercount usage until the next reconciliation, which is preferable to
    // blocking workspace startup on a replica that never released its entry.
    if (active > 0) this.onDrainTimeout?.(active)
  }
}
