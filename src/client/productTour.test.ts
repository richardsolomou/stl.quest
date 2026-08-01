import { describe, expect, it } from 'vitest'
import { readProductTourProgress, writeProductTourProgress } from './productTour'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  }
}

describe('product tour progress', () => {
  it('round-trips progress for one user', () => {
    const storage = memoryStorage()
    writeProductTourProgress(storage, 'maker', { completedTasks: ['upload'], snoozedUntil: 1234 })
    expect(readProductTourProgress(storage, 'maker')).toEqual({ completedTasks: ['upload'], snoozedUntil: 1234 })
  })

  it('does not share progress between users', () => {
    const storage = memoryStorage()
    writeProductTourProgress(storage, 'maker', { completedTasks: ['upload'] })
    expect(readProductTourProgress(storage, 'admin')).toEqual({ completedTasks: [] })
  })

  it('ignores malformed and unknown progress', () => {
    const storage = memoryStorage()
    storage.setItem('stlquest:tour-onboarding-request-queue:maker', '{')
    expect(readProductTourProgress(storage, 'maker')).toEqual({ completedTasks: [] })
  })
})
