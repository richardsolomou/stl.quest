import { parentPort } from 'node:worker_threads'
import { app, shutdownApp } from './app'
import { STORAGE_RUNTIME_REVISION_SETTING } from './storageMigration'

if (!parentPort) throw new Error('distributed replica worker requires a parent port')

const instance = await app()
parentPort.postMessage('ready')
parentPort.on('message', async (message: { id: string; type: string; revision?: string }) => {
  if (message.type === 'close') {
    await shutdownApp()
    parentPort!.postMessage({ id: message.id, value: 'closed' })
    return
  }
  if (message.type === 'revision') {
    const runtime = await instance.defaultWorkspaceRuntime()
    parentPort!.postMessage({ id: message.id, value: runtime.storageRevision })
    return
  }
  if (message.type === 'change-revision') {
    const repository = await instance.repository.scoped('test-workspace')
    await repository.setSetting(STORAGE_RUNTIME_REVISION_SETTING, message.revision)
    const runtime = await instance.defaultWorkspaceRuntime()
    runtime.events.publish('storage.changed')
    parentPort!.postMessage({ id: message.id, value: message.revision })
  }
})
