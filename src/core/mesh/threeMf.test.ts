import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import type { PlatePlacement } from '../platePlanner'
import { exportPlate3mf } from './threeMf'

const positions = new Float32Array([
  -1, -2, -3, 1, -2, -3, 1, 2, -3, -1, -2, -3, 1, 2, -3, -1, 2, -3, -1, -2, 3, 1, 2, 3, 1, -2, 3, -1, -2, 3, -1, 2, 3, 1, 2, 3, -1, -2, -3,
  -1, -2, 3, 1, -2, 3, -1, -2, -3, 1, -2, 3, 1, -2, -3, 1, -2, -3, 1, -2, 3, 1, 2, 3, 1, -2, -3, 1, 2, 3, 1, 2, -3, 1, 2, -3, 1, 2, 3, -1,
  2, 3, 1, 2, -3, -1, 2, 3, -1, 2, -3, -1, 2, -3, -1, 2, 3, -1, -2, 3, -1, 2, -3, -1, -2, 3, -1, -2, -3,
])

function placement(copyId: string, rotationZDegrees = 0): PlatePlacement {
  return {
    copyId,
    requestId: 'request-1',
    name: `Model ${copyId}`,
    footprint: { widthMm: 2, depthMm: 4, known: true },
    estimatedSupportedHeightMm: 6,
    orientationQuaternion: [0, 0, 0, 1],
    xMm: 20,
    yMm: 30,
    rotationZDegrees,
  }
}

describe('3MF export', () => {
  it('packages reusable original geometry and separate build items', () => {
    const archive = unzipSync(
      exportPlate3mf([placement('copy-1'), placement('copy-2')], new Map([['request-1', { name: 'Model & part', positions }]])),
    )
    const model = strFromU8(archive['3D/3dmodel.model'])

    expect(Object.keys(archive).sort()).toEqual(['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels'])
    expect(model.match(/<object /g)).toHaveLength(1)
    expect(model.match(/<item /g)).toHaveLength(2)
    expect(model).toContain('name="Model &amp; part"')
    expect(model).toContain('transform="1 0 0 0 1 0 0 0 1 20 30 3"')
    expect(model.match(/<triangle /g)).toHaveLength(12)
  })

  it('writes plate rotation in the 3MF row-major transform order', () => {
    const archive = unzipSync(exportPlate3mf([placement('copy-1', 90)], new Map([['request-1', { name: 'Model', positions }]])))
    const model = strFromU8(archive['3D/3dmodel.model'])

    expect(model).toContain('transform="0 1 0 -1 0 0 0 0 1 20 30 3"')
  })

  it('preserves the selected model orientation and places it on the build surface', () => {
    const oriented: PlatePlacement = { ...placement('copy-1'), orientationQuaternion: [Math.SQRT1_2, 0, 0, Math.SQRT1_2] }
    const archive = unzipSync(exportPlate3mf([oriented], new Map([['request-1', { name: 'Model', positions }]])))
    const model = strFromU8(archive['3D/3dmodel.model'])

    expect(model).toContain('transform="1 0 0 0 0 1 0 -1 0 20 30 2"')
  })

  it('rejects plates without every original mesh', () => {
    expect(() => exportPlate3mf([placement('copy-1')], new Map())).toThrow('Missing original mesh for Model copy-1')
  })
})
