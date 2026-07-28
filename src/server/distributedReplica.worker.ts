import { parentPort } from 'node:worker_threads'
import { app, shutdownApp } from './app'

if (!parentPort) throw new Error('distributed replica worker requires a parent port')

await app()
parentPort.postMessage('ready')
parentPort.once('message', async (message) => {
  if (message !== 'close') return
  await shutdownApp()
  parentPort!.postMessage('closed')
})
