import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import type { PrinterProfile } from '../core/types'
import { storeInventory } from './inventory'
import { printersQuery } from './queries'

const printer: PrinterProfile = { id: 'mk4', name: 'MK4', printType: 'filament' }
const runs = [{ printerId: 'mk4', runs: 25, failed: 2 }]

describe('storeInventory', () => {
  it('keeps the rest of what the list query returned', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(printersQuery('shop').queryKey, { profiles: [], runs })
    storeInventory(queryClient, 'shop', 'printers', [printer])
    expect(queryClient.getQueryData(printersQuery('shop').queryKey)).toEqual({ profiles: [printer], runs })
  })
})
