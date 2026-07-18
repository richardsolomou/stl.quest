import { strFromU8, unzlibSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import type { PlatePlacement } from '../platePlanner'
import { exportPlateVoxl } from './voxl'

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

describe('VOXL export', () => {
  it('packages separate model instances with one shared embedded mesh', () => {
    const file = exportPlateVoxl(
      [placement('copy-1'), placement('copy-2')],
      new Map([['request-1', { name: 'Model part', positions }]]),
      { widthMm: 100, depthMm: 80 },
      new Date('2026-07-18T12:00:00.000Z'),
    )
    const parsed = parseVoxl(file)

    expect(parsed.version).toBe(3)
    expect(parsed.chunks.filter((chunk) => chunk.type === 'MESH')).toHaveLength(1)
    expect(parsed.json.MODL).toMatchObject([
      {
        id: 'copy-1',
        transform: { position: { x: -30, y: 3, z: 10 }, rotation: { x: 0, y: 0, z: 0 } },
        mesh: { mode: 'embedded-chunk' },
      },
      { id: 'copy-2', mesh: { mode: 'embedded-chunk', chunkIndex: 0 } },
    ])
    expect(parsed.json.SUPP).toMatchObject({ version: 1, roots: [], trunks: [], branches: [], leaves: [], braces: [], knots: [] })
  })

  it('converts build-axis rotation into DragonFruit coordinates', () => {
    const file = exportPlateVoxl([placement('copy-1', 90)], new Map([['request-1', { name: 'Model', positions }]]), {
      widthMm: 100,
      depthMm: 80,
    })
    const model = parseVoxl(file).json.MODL[0]

    expect(model.transform.rotation.x).toBeCloseTo(0)
    expect(model.transform.rotation.y).toBeCloseTo(Math.PI / 2)
    expect(model.transform.rotation.z).toBeCloseTo(0)
  })

  it('writes current V2 containers when every instance has unique geometry', () => {
    const second = { ...placement('copy-2'), requestId: 'request-2' }
    const file = exportPlateVoxl(
      [placement('copy-1'), second],
      new Map([
        ['request-1', { name: 'First', positions }],
        ['request-2', { name: 'Second', positions }],
      ]),
      { widthMm: 100, depthMm: 80 },
    )

    expect(parseVoxl(file).version).toBe(2)
  })

  it('rejects plates without every original mesh', () => {
    expect(() => exportPlateVoxl([placement('copy-1')], new Map(), { widthMm: 100, depthMm: 80 })).toThrow(
      'Missing original mesh for Model copy-1',
    )
  })
})

function parseVoxl(file: Uint8Array) {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
  const version = view.getUint16(4, true)
  const chunkCount = view.getUint32(8, true)
  const chunks = Array.from({ length: chunkCount }, (_, index) => {
    const directoryOffset = 16 + index * 20
    const type = strFromU8(file.subarray(directoryOffset, directoryOffset + 4))
    const chunkIndex = view.getUint16(directoryOffset + 4, true)
    const compression = view.getUint16(directoryOffset + 6, true)
    const offset = view.getUint32(directoryOffset + 8, true)
    const length = view.getUint32(directoryOffset + 12, true)
    const bytes = file.subarray(offset, offset + length)
    return { type, index: chunkIndex, bytes: compression === 1 ? unzlibSync(bytes) : bytes }
  })
  const json = Object.fromEntries(
    chunks.filter((chunk) => chunk.type !== 'MESH').map((chunk) => [chunk.type, JSON.parse(strFromU8(chunk.bytes))]),
  ) as Record<string, any>
  return { version, chunks, json }
}
