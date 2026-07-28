export type WorkLock = {
  lock(signal: AbortSignal, onLost: () => void): Promise<void>
  tryLock?(signal: AbortSignal, onLost: () => void): Promise<boolean>
  unlock(): Promise<void>
}

export type WorkLocker = {
  newLock(id: string): WorkLock
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
