import { strToU8, zlibSync } from 'fflate'
import * as THREE from 'three'
import type { PlatePlacement } from '../platePlanner'
import { exportBinaryStl } from './stl'
import { placementMatrix, type PlateMesh } from './plateTransform'

export type DragonFruitPlate = {
  widthMm: number
  depthMm: number
}

type Chunk = {
  type: 'META' | 'SCNE' | 'MODL' | 'MESH' | 'SUPP'
  index: number
  data: Uint8Array
  compression: 0 | 1
  uncompressedSize: number
}

const axisConversion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)
const axisConversionInverse = axisConversion.clone().invert()

export function exportPlateVoxl(
  placements: PlatePlacement[],
  meshes: Map<string, PlateMesh>,
  plate: DragonFruitPlate,
  createdAt = new Date(),
) {
  if (!(plate.widthMm > 0) || !(plate.depthMm > 0)) throw new Error('DragonFruit export requires valid plate dimensions')

  const meshBytes = new Map<string, Uint8Array>()
  const ownerIndex = new Map<string, number>()
  const models = placements.map((placement, index) => {
    const mesh = meshes.get(placement.requestId)
    if (!mesh) throw new Error(`Missing original mesh for ${placement.name}`)

    let bytes = meshBytes.get(placement.requestId)
    if (!bytes) {
      bytes = dragonFruitStl(mesh.positions)
      meshBytes.set(placement.requestId, bytes)
      ownerIndex.set(placement.requestId, index)
    }

    const owner = ownerIndex.get(placement.requestId)!
    const transform = dragonFruitTransform(placement, mesh.positions, plate)
    return {
      id: placement.copyId,
      name: placement.name,
      visible: true,
      color: '#f59e0b',
      polygonCount: mesh.positions.length / 9,
      fileSizeBytes: bytes.length,
      transform,
      mesh: {
        mode: 'embedded-chunk',
        fileName: `${fileNamePart(mesh.name)}.stl`,
        mimeType: 'model/stl',
        uncompressedSizeBytes: bytes.length,
        ...(owner === index ? {} : { chunkIndex: owner }),
      },
    }
  })

  const timestamp = createdAt.toISOString()
  const chunks: Chunk[] = [
    jsonChunk('META', {
      generator: 'PrintHub',
      createdAt: timestamp,
      updatedAt: timestamp,
      units: 'mm',
      coordinateSystem: 'right-handed-z-up',
    }),
    jsonChunk('SCNE', { activeModelId: models[0]?.id ?? null, selectedModelIds: [] }),
    jsonChunk('MODL', models, true),
  ]

  for (const [requestId, bytes] of meshBytes) {
    chunks.push(compressedChunk('MESH', ownerIndex.get(requestId)!, bytes))
  }

  chunks.push(
    jsonChunk(
      'SUPP',
      {
        version: 1,
        meta: { source: 'printhub', objectCenter: { x: 0, y: 0, z: 0 }, updatedAt: createdAt.getTime() },
        roots: [],
        trunks: [],
        branches: [],
        leaves: [],
        twigs: [],
        sticks: [],
        braces: [],
        anchors: [],
        knots: [],
        kickstands: [],
      },
      true,
    ),
  )

  return container(chunks, meshBytes.size < placements.length ? 3 : 2)
}

function dragonFruitStl(positions: Float32Array) {
  const converted = new Float32Array(positions.length)
  for (let index = 0; index < positions.length; index += 3) {
    converted[index] = positions[index]
    converted[index + 1] = positions[index + 2]
    converted[index + 2] = -positions[index + 1]
  }
  const indices = Uint32Array.from({ length: converted.length / 3 }, (_, index) => index)
  return exportBinaryStl(converted, indices)
}

function dragonFruitTransform(placement: PlatePlacement, positions: Float32Array, plate: DragonFruitPlate) {
  const position = new THREE.Vector3()
  const rotation = new THREE.Quaternion()
  placementMatrix(placement, positions).decompose(position, rotation, new THREE.Vector3())
  position.x -= plate.widthMm / 2
  position.y -= plate.depthMm / 2
  position.applyQuaternion(axisConversion)
  rotation.premultiply(axisConversion).multiply(axisConversionInverse)
  const euler = new THREE.Euler().setFromQuaternion(rotation, 'ZYX')
  return {
    position: vector(position),
    rotation: vector(euler),
    scale: { x: 1, y: 1, z: 1 },
  }
}

function vector(value: THREE.Vector3 | THREE.Euler) {
  return { x: clean(value.x), y: clean(value.y), z: clean(value.z) }
}

function clean(value: number) {
  if (Math.abs(value) < 1e-9) return 0
  return Number(value.toFixed(12))
}

function jsonChunk(type: Chunk['type'], value: unknown, compress = false) {
  const bytes = strToU8(JSON.stringify(value))
  return compress
    ? compressedChunk(type, 0, bytes)
    : { type, index: 0, data: bytes, compression: 0 as const, uncompressedSize: bytes.length }
}

function compressedChunk(type: Chunk['type'], index: number, bytes: Uint8Array): Chunk {
  if (bytes.length > 64) {
    const compressed = zlibSync(bytes, { level: 6 })
    if (compressed.length < bytes.length) return { type, index, data: compressed, compression: 1, uncompressedSize: bytes.length }
  }
  return { type, index, data: bytes, compression: 0, uncompressedSize: bytes.length }
}

function container(chunks: Chunk[], version: 2 | 3) {
  const headerSize = 16
  const directoryEntrySize = 20
  let offset = headerSize + chunks.length * directoryEntrySize
  const size = offset + chunks.reduce((total, chunk) => total + chunk.data.length, 0)
  const output = new Uint8Array(size)
  const view = new DataView(output.buffer)
  output.set(strToU8('VOXL'), 0)
  view.setUint16(4, version, true)
  view.setUint32(8, chunks.length, true)

  chunks.forEach((chunk, index) => {
    if (chunk.index > 0xffff) throw new Error('DragonFruit export contains too many model instances')
    const directoryOffset = headerSize + index * directoryEntrySize
    output.set(strToU8(chunk.type), directoryOffset)
    view.setUint16(directoryOffset + 4, chunk.index, true)
    view.setUint16(directoryOffset + 6, chunk.compression, true)
    view.setUint32(directoryOffset + 8, offset, true)
    view.setUint32(directoryOffset + 12, chunk.data.length, true)
    view.setUint32(directoryOffset + 16, chunk.uncompressedSize, true)
    output.set(chunk.data, offset)
    offset += chunk.data.length
  })

  return output
}

function fileNamePart(value: string) {
  return (
    value
      .trim()
      .replace(/[^a-z0-9._-]+/gi, '-')
      .replace(/^-|-$/g, '') || 'model'
  )
}
