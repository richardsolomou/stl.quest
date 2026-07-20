import { describe, expect, it } from 'vitest'
import type { PrinterProfile } from './types'
import { automaticallyAssignedPrinter, normalizePrinterProfile } from './printers'

const small: PrinterProfile = {
  id: 'small',
  name: 'Small',
  printType: 'resin',
  enabled: true,
  widthMm: 100,
  depthMm: 100,
}
const large: PrinterProfile = { ...small, id: 'large', name: 'Large', widthMm: 200, depthMm: 200, heightMm: 250 }

describe('printer profiles', () => {
  it('preserves the preset used for printer imagery', () => {
    expect(
      normalizePrinterProfile({
        id: 'mars-2',
        presetId: 'resin-elegoo-mars-2',
        name: 'Elegoo Mars 2',
        printType: 'resin',
        enabled: true,
      }).presetId,
    ).toBe('resin-elegoo-mars-2')
  })

  it('preserves build plate dimensions for workload balancing', () => {
    expect(normalizePrinterProfile({ ...large }).widthMm).toBe(200)
  })

  it('recovers missing dimensions from a saved preset', () => {
    expect(normalizePrinterProfile({ id: 'mars-2', presetId: 'resin-elegoo-mars-2', name: 'Elegoo Mars 2' }).widthMm).toBe(82.62)
  })

  it('recovers a dropped preset ID from the predefined printer name', () => {
    expect(
      normalizePrinterProfile({
        id: 'mars-2',
        name: 'Elegoo Mars 2',
        printType: 'resin',
        widthMm: 100,
        depthMm: 100,
      }).presetId,
    ).toBe('resin-elegoo-mars-2')
  })

  it('assigns a model only to printers whose build volume can contain it', () => {
    expect(automaticallyAssignedPrinter([small, large], [], 'resin', undefined, { widthMm: 150, depthMm: 80, heightMm: 120 })?.id).toBe(
      large.id,
    )
  })

  it('allows rotating a model on the build plate', () => {
    const rotated = { ...small, widthMm: 80, depthMm: 120, heightMm: 150 }

    expect(automaticallyAssignedPrinter([rotated], [], 'resin', undefined, { widthMm: 110, depthMm: 70, heightMm: 100 })?.id).toBe(
      rotated.id,
    )
  })

  it('leaves oversized models unassigned', () => {
    expect(
      automaticallyAssignedPrinter([small, large], [], 'resin', undefined, { widthMm: 300, depthMm: 250, heightMm: 200 }),
    ).toBeUndefined()
  })

  it('assigns equal copy counts to the printer with more build plate capacity', () => {
    const requests = [
      { id: 'small-work', printerId: small.id, counts: { todo: 1, in_progress: 0, post_processing: 0, done: 0 } },
      { id: 'large-work', printerId: large.id, counts: { todo: 1, in_progress: 0, post_processing: 0, done: 0 } },
    ]

    expect(automaticallyAssignedPrinter([small, large], requests, 'resin')?.id).toBe(large.id)
  })

  it('ignores completed copies when choosing a printer', () => {
    const requests = [{ id: 'finished', printerId: small.id, counts: { todo: 0, in_progress: 0, post_processing: 0, done: 50 } }]

    expect(automaticallyAssignedPrinter([small, large], requests, 'resin')?.id).toBe(small.id)
  })

  it('uses average known capacity for custom printers', () => {
    const custom = { ...small, id: 'custom', name: 'Custom', widthMm: undefined, depthMm: undefined }
    const requests = [{ id: 'custom-work', printerId: custom.id, counts: { todo: 2, in_progress: 0, post_processing: 0, done: 0 } }]

    expect(automaticallyAssignedPrinter([small, large, custom], requests, 'resin')?.id).toBe(small.id)
  })
})
