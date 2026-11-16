import type { AsyncLocalStorage } from 'node:async_hooks'

/** The server function a call runs, as TanStack Start's compiler names it. */
export type ServerFunctionIdentity = { name: string; filename: string }

type NodeProcess = { getBuiltinModule?: (id: 'node:async_hooks') => typeof import('node:async_hooks') | undefined }

let storage: AsyncLocalStorage<ServerFunctionIdentity> | null | undefined

// Resolved through the running process, because `src/start.ts` puts this module in the browser graph too.
function identityStorage() {
  if (storage === undefined) {
    const hooks = (globalThis as { process?: NodeProcess }).process?.getBuiltinModule?.('node:async_hooks')
    storage = hooks ? new hooks.AsyncLocalStorage<ServerFunctionIdentity>() : null
  }
  return storage
}

/** Runs work with its server function's identity available to logs and telemetry recorded inside it. */
export function withServerFunction<T>(identity: ServerFunctionIdentity, work: () => T): T {
  const current = identityStorage()
  return current ? current.run(identity, work) : work()
}

export function currentServerFunction(): ServerFunctionIdentity | undefined {
  return identityStorage()?.getStore()
}
