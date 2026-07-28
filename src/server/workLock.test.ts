import { describe, expect, it, vi } from 'vitest'
import { WorkDrainTimeout, WorkGate, type WorkLocker, type WorkRegistry } from './workLock'

function deferred() {
  let resolve!: () => void
  return { promise: new Promise<void>((r) => (resolve = r)), resolve }
}

// Mirrors RedisLocker: one mutex per id, plus a deadline-scored registry shared by every gate.
function sharedLocker() {
  const held = new Map<string, Promise<void>>()
  const entries = new Map<string, number>()
  const registry: WorkRegistry = {
    register: async (entry, deadline) => void entries.set(entry, deadline),
    release: async (entry) => void entries.delete(entry),
    activeCount: async (now) => {
      for (const [entry, deadline] of entries) if (deadline <= now) entries.delete(entry)
      return entries.size
    },
  }
  const locker: WorkLocker = {
    newLock: (id) => {
      let release!: () => void
      return {
        lock: async () => {
          const previous = held.get(id) ?? Promise.resolve()
          held.set(id, new Promise<void>((resolve) => (release = resolve)))
          await previous
        },
        unlock: async () => release(),
      }
    },
    newRegistry: () => registry,
  }
  return { locker, entries }
}

describe('WorkGate', () => {
  it('runs work on different keys concurrently', async () => {
    const gate = new WorkGate('subject')
    const first = deferred()
    let secondFinished = false

    const blocked = gate.perKey('models/a.stl', async () => await first.promise)
    await gate.perKey('models/b.stl', async () => void (secondFinished = true))

    expect(secondFinished).toBe(true)
    first.resolve()
    await blocked
  })

  it('serializes work on the same key', async () => {
    const gate = new WorkGate('subject')
    const order: string[] = []
    const first = deferred()

    const blocked = gate.perKey('models/a.stl', async () => {
      await first.promise
      order.push('first')
    })
    const queued = gate.perKey('models/a.stl', async () => void order.push('second'))

    expect(order).toEqual([])
    first.resolve()
    await Promise.all([blocked, queued])
    expect(order).toEqual(['first', 'second'])
  })

  it('waits for per-key work in flight before running exclusive work', async () => {
    const gate = new WorkGate('subject')
    const order: string[] = []
    const writing = deferred()

    const write = gate.perKey('models/a.stl', async () => {
      await writing.promise
      order.push('write')
    })
    const scan = gate.exclusive(async () => void order.push('scan'))

    expect(order).toEqual([])
    writing.resolve()
    await Promise.all([write, scan])
    expect(order).toEqual(['write', 'scan'])
  })

  it('holds back new per-key work while exclusive work runs', async () => {
    const gate = new WorkGate('subject')
    const order: string[] = []
    const scanning = deferred()

    const scan = gate.exclusive(async () => {
      await scanning.promise
      order.push('scan')
    })
    const write = gate.perKey('models/a.stl', async () => void order.push('write'))

    expect(order).toEqual([])
    scanning.resolve()
    await Promise.all([scan, write])
    expect(order).toEqual(['scan', 'write'])
  })

  it('waits for another replica to finish its registered write', async () => {
    const { locker, entries } = sharedLocker()
    const replica = new WorkGate('subject', locker)
    const other = new WorkGate('subject', locker)
    const writing = deferred()
    const write = other.perKey('models/a.stl', async () => await writing.promise)
    await vi.waitFor(() => expect(entries.size).toBe(1))

    let scanned = false
    const scan = replica.exclusive(async () => void (scanned = true))
    await new Promise((resolve) => setTimeout(resolve, 150))

    expect(scanned).toBe(false)
    writing.resolve()
    await Promise.all([write, scan])
    expect(scanned).toBe(true)
  })

  it('stops waiting on an entry whose replica died mid-operation', async () => {
    const { locker, entries } = sharedLocker()
    const gate = new WorkGate('subject', locker)
    entries.set('models/a.stl:abandoned', Date.now() - 1)

    await expect(gate.exclusive(async () => 'reconciled')).resolves.toBe('reconciled')
    expect(entries.size).toBe(0)
  })

  it('does not retain local work when distributed registration fails', async () => {
    const registry: WorkRegistry = {
      register: async () => {
        throw new Error('Redis unavailable')
      },
      release: async () => undefined,
      activeCount: async () => 0,
    }
    const locker: WorkLocker = {
      newLock: () => ({ lock: async () => undefined, unlock: async () => undefined }),
      newRegistry: () => registry,
    }
    const gate = new WorkGate('subject', locker)

    await expect(gate.perKey('models/a.stl', async () => undefined)).rejects.toThrow('Redis unavailable')
    await expect(gate.exclusive(async () => 'reconciled')).resolves.toBe('reconciled')
  })

  it('fails closed while another replica still has active work', async () => {
    vi.useFakeTimers()
    const { locker, entries } = sharedLocker()
    entries.set('models/a.stl:active', Date.now() + 60_000)
    const gate = new WorkGate('subject', locker)
    const scan = gate.exclusive(async () => 'reconciled')
    const result = scan.catch((error) => error)

    await vi.advanceTimersByTimeAsync(30_000)

    expect(await result).toBeInstanceOf(WorkDrainTimeout)
    vi.useRealTimers()
  })
})
