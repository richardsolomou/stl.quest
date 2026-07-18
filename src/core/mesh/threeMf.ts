import { strToU8, zipSync } from 'fflate'
import type { PlatePlacement } from '../platePlanner'
import { placementMatrix, type PlateMesh } from './plateTransform'

export function exportPlate3mf(placements: PlatePlacement[], meshes: Map<string, PlateMesh>): Uint8Array {
  const requestIds = [...new Set(placements.map((placement) => placement.requestId))]
  const objectIds = new Map(requestIds.map((requestId, index) => [requestId, index + 1]))
  const objects = requestIds.map((requestId) => {
    const mesh = meshes.get(requestId)
    if (!mesh) {
      const placement = placements.find((candidate) => candidate.requestId === requestId)
      throw new Error(`Missing original mesh for ${placement?.name ?? requestId}`)
    }
    return objectXml(objectIds.get(requestId)!, mesh)
  })
  const items = placements.map((placement) => {
    const mesh = meshes.get(placement.requestId)
    if (!mesh) throw new Error(`Missing original mesh for ${placement.name}`)
    return `    <item objectid="${objectIds.get(placement.requestId)}" transform="${placementTransform(placement, mesh.positions)}" />`
  })
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Application">PrintHub</metadata>
  <resources>
${objects.join('\n')}
  </resources>
  <build>
${items.join('\n')}
  </build>
</model>`

  return zipSync(
    {
      '[Content_Types].xml': strToU8(contentTypesXml),
      '_rels/.rels': strToU8(relationshipsXml),
      '3D/3dmodel.model': strToU8(model),
    },
    { level: 6 },
  )
}

function objectXml(id: number, mesh: PlateMesh) {
  const indexed = indexPositions(mesh.positions)
  const vertices = indexed.vertices.map(
    ([x, y, z]) => `          <vertex x="${formatNumber(x)}" y="${formatNumber(y)}" z="${formatNumber(z)}" />`,
  )
  const triangles = indexed.triangles.map(([v1, v2, v3]) => `          <triangle v1="${v1}" v2="${v2}" v3="${v3}" />`)
  return `    <object id="${id}" type="model" name="${escapeXml(mesh.name)}">
      <mesh>
        <vertices>
${vertices.join('\n')}
        </vertices>
        <triangles>
${triangles.join('\n')}
        </triangles>
      </mesh>
    </object>`
}

function indexPositions(positions: Float32Array) {
  if (positions.length === 0 || positions.length % 9 !== 0) throw new Error('Original mesh does not contain complete triangles')
  const vertices: [number, number, number][] = []
  const triangles: [number, number, number][] = []
  const indices = new Map<string, number>()
  for (let offset = 0; offset < positions.length; offset += 9) {
    const triangle: [number, number, number] = [0, 0, 0]
    for (let vertex = 0; vertex < 3; vertex++) {
      const index = offset + vertex * 3
      const point: [number, number, number] = [positions[index], positions[index + 1], positions[index + 2]]
      if (!point.every(Number.isFinite)) throw new Error('Original mesh contains invalid coordinates')
      const key = point.join('|')
      let vertexIndex = indices.get(key)
      if (vertexIndex === undefined) {
        vertexIndex = vertices.length
        vertices.push(point)
        indices.set(key, vertexIndex)
      }
      triangle[vertex] = vertexIndex
    }
    triangles.push(triangle)
  }
  return { vertices, triangles }
}

function placementTransform(placement: PlatePlacement, positions: Float32Array) {
  const elements = placementMatrix(placement, positions).elements
  return [
    elements[0],
    elements[1],
    elements[2],
    elements[4],
    elements[5],
    elements[6],
    elements[8],
    elements[9],
    elements[10],
    elements[12],
    elements[13],
    elements[14],
  ]
    .map(formatNumber)
    .join(' ')
}

function formatNumber(value: number) {
  if (Math.abs(value) < 1e-9) return '0'
  return value.toFixed(9).replace(/\.?0+$/, '')
}

function escapeXml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&apos;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

const contentTypesXml = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
</Types>`

const relationshipsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`
