import { EventEmitter } from 'node:events'
import type { EventBus } from '../core/types'

export class LocalEventBus implements EventBus {
  private emitter = new EventEmitter()

  constructor() { this.emitter.setMaxListeners(100) }

  publish(event: string) {
    this.emitter.emit('change', event)
  }

  subscribe(listener: (event: string) => void) {
    this.emitter.on('change', listener)
    return () => this.emitter.off('change', listener)
  }
}
