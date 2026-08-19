import * as THREE from 'three'
import { unzipSync } from 'fflate'
import { XMLParser } from 'fast-xml-parser'
import { InvalidMeshError } from './stl'

type XmlNode = Record<string, unknown>

const array = <T>(value: T | T[] | undefined): T[] => (value === undefined ? [] : Array.isArray(value) ? value : [value])

export function isThreeMf(file: Uint8Array) {
  return file.byteLength >= 4 && file[0] === 0x50 && file[1] === 0x4b && file[2] === 0x03 && file[3] === 0x04
}

// Run one parse stage, converting an unexpected fault into an InvalidMeshError that names the
// stage and keeps the original error as its cause. An InvalidMeshError already carries a precise
// message, so it passes through unchanged. The stage name and cause tell us which 3MF feature
// broke instead of collapsing every failure into one opaque message.
function stage<T>(name: string, run: () => T): T {
  try {
    return run()
  } catch (error) {
    if (error instanceof InvalidMeshError) throw error
    throw new InvalidMeshError(`could not parse 3MF (${name})`, { cause: error })
  }
}

export function parseThreeMf(file: Uint8Array): Float32Array {
  const archive = stage('unzip', () => unzipSync(file))
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', parseAttributeValue: true })
  const models = new Map<string, XmlNode>()
  for (const name of Object.keys(archive).filter((entry) => /^3D\/.*\.model$/i.test(entry))) {
    const parsed = stage('xml', () => parser.parse(new TextDecoder().decode(archive[name]))) as { model?: XmlNode }
    if (parsed.model) models.set(normalizePartName(name), parsed.model)
  }
  return stage('geometry', () => {
    const mainName = [...models.keys()].find((name) => name.toLowerCase() === '3d/3dmodel.model') ?? models.keys().next().value
    if (!mainName) throw new InvalidMeshError('3MF does not contain a model')
    const output: number[] = []

    const appendObject = (modelName: string, id: string, parent: THREE.Matrix4, stack = new Set<string>()) => {
      const model = models.get(modelName)
      if (!model) throw new InvalidMeshError('3MF references a missing model part')
      const resources = model.resources as XmlNode | undefined
      const objects = new Map(array(resources?.object as XmlNode | XmlNode[] | undefined).map((object) => [String(object.id), object]))
      const scale = unitScale(typeof model.unit === 'string' ? model.unit : 'millimeter')
      const objectKey = `${modelName}:${id}`
      if (stack.has(objectKey)) throw new InvalidMeshError('3MF contains recursive components')
      const object = objects.get(id)
      if (!object) throw new InvalidMeshError('3MF references a missing object')
      const nextStack = new Set(stack).add(objectKey)
      const mesh = object.mesh as XmlNode | undefined
      if (mesh) appendMesh(mesh, parent, scale, output)
      const components = object.components as XmlNode | undefined
      for (const component of array(components?.component as XmlNode | XmlNode[] | undefined)) {
        const componentPath = component['p:path'] ?? component.path
        const componentModel = typeof componentPath === 'string' ? normalizePartName(componentPath) : modelName
        appendObject(componentModel, String(component.objectid), parent.clone().multiply(transform(component.transform, scale)), nextStack)
      }
    }

    const model = models.get(mainName)!
    const scale = unitScale(typeof model.unit === 'string' ? model.unit : 'millimeter')
    const build = model.build as XmlNode | undefined
    for (const item of array(build?.item as XmlNode | XmlNode[] | undefined)) {
      appendObject(mainName, String(item.objectid), transform(item.transform, scale))
    }
    if (!output.length) throw new InvalidMeshError('empty 3MF')
    const positions = new Float32Array(output)
    center(positions)
    return positions
  })
}

function normalizePartName(name: string) {
  return name.replace(/^\/+/, '')
}

function appendMesh(mesh: XmlNode, matrix: THREE.Matrix4, scale: number, output: number[]) {
  const verticesNode = mesh.vertices as XmlNode | undefined
  const trianglesNode = mesh.triangles as XmlNode | undefined
  const vertices = array(verticesNode?.vertex as XmlNode | XmlNode[] | undefined).map((vertex) =>
    new THREE.Vector3(Number(vertex.x) * scale, Number(vertex.y) * scale, Number(vertex.z) * scale).applyMatrix4(matrix),
  )
  for (const triangle of array(trianglesNode?.triangle as XmlNode | XmlNode[] | undefined)) {
    for (const key of ['v1', 'v2', 'v3']) {
      const vertex = vertices[Number(triangle[key])]
      if (!vertex) throw new InvalidMeshError('3MF contains an invalid triangle')
      output.push(vertex.x, vertex.y, vertex.z)
    }
  }
}

function transform(value: unknown, scale: number) {
  if (typeof value !== 'string' || !value.trim()) return new THREE.Matrix4()
  const values = value.trim().split(/\s+/).map(Number)
  if (values.length !== 12 || values.some((entry) => !Number.isFinite(entry))) throw new InvalidMeshError('invalid 3MF transform')
  return new THREE.Matrix4().set(
    values[0],
    values[3],
    values[6],
    values[9] * scale,
    values[1],
    values[4],
    values[7],
    values[10] * scale,
    values[2],
    values[5],
    values[8],
    values[11] * scale,
    0,
    0,
    0,
    1,
  )
}

function unitScale(unit: string) {
  return { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 }[unit] ?? 1
}

function center(positions: Float32Array) {
  const box = new THREE.Box3().setFromBufferAttribute(new THREE.BufferAttribute(positions, 3))
  const midpoint = box.getCenter(new THREE.Vector3())
  for (let index = 0; index < positions.length; index += 3) {
    positions[index] -= midpoint.x
    positions[index + 1] -= midpoint.y
    positions[index + 2] -= midpoint.z
  }
}
