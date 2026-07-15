import { describe, expect, it } from 'vitest'
import { estimateMaterialUsage } from './material'
import type { PrinterProfile } from './platePlanner'

const filamentPrinter = {
  id: 'filament',
  name: 'Filament printer',
  printType: 'filament',
  enabled: true,
  widthMm: 220,
  depthMm: 220,
  heightMm: 250,
  spacingMm: 3,
  brimMarginMm: 2,
  filamentDiameterMm: 1.75,
  materialDensityGPerCm3: 1.24,
} satisfies PrinterProfile

describe('estimateMaterialUsage', () => {
  it('reports resin geometry volume in milliliters', () => {
    expect(estimateMaterialUsage({ printType: 'resin', estimatedVolumeMm3: 2_500, quantity: 3 })).toMatchObject({
      printType: 'resin',
      unit: 'ml',
      perCopy: 2.5,
      total: 7.5,
    })
  })

  it('reports filament 100%-solid equivalent mass and length', () => {
    expect(
      estimateMaterialUsage({ printType: 'filament', estimatedVolumeMm3: 10_000, quantity: 2, printer: filamentPrinter }),
    ).toMatchObject({
      printType: 'filament',
      unit: 'g',
      perCopy: 12.4,
      total: 24.8,
      filamentMetersPerCopy: 10_000 / (Math.PI * Math.pow(1.75 / 2, 2)) / 1_000,
      filamentMetersTotal: 20_000 / (Math.PI * Math.pow(1.75 / 2, 2)) / 1_000,
    })
  })

  it('does not invent filament usage without matching material settings', () => {
    expect(estimateMaterialUsage({ printType: 'filament', estimatedVolumeMm3: 10_000 })).toBeUndefined()
  })

  it('rejects invalid geometry and quantities', () => {
    expect(estimateMaterialUsage({ printType: 'resin', estimatedVolumeMm3: Number.NaN })).toBeUndefined()
    expect(estimateMaterialUsage({ printType: 'resin', estimatedVolumeMm3: 1_000, quantity: 0 })).toBeUndefined()
  })
})
