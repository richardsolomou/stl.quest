import * as THREE from 'three'
import { OBJLoader } from 'three-stdlib'
import { InvalidMeshError } from './stl'

export function isObj(file: Uint8Array) {
  return /^v[ \t]+[-+\d.]/m.test(new TextDecoder().decode(file.subarray(0, 65_536)))
}

export function parseObj(file: Uint8Array): Float32Array {
  let object: THREE.Group
  try {
    object = new OBJLoader().parse(new TextDecoder().decode(file))
  } catch (error) {
    throw new InvalidMeshError('could not parse OBJ', { cause: error })
  }

  const values: number[] = []
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const position = child.geometry.getAttribute('position')
    for (let index = 0; index < position.count; index++) {
      values.push(position.getX(index), position.getY(index), position.getZ(index))
    }
  })
  if (!values.length) throw new InvalidMeshError('empty OBJ')
  const positions = new Float32Array(values)
  if (positions.some((value) => !Number.isFinite(value))) throw new InvalidMeshError('invalid OBJ vertex')
  const box = new THREE.Box3().setFromBufferAttribute(new THREE.BufferAttribute(positions, 3))
  const center = box.getCenter(new THREE.Vector3())
  for (let index = 0; index < positions.length; index += 3) {
    positions[index] -= center.x
    positions[index + 1] -= center.y
    positions[index + 2] -= center.z
  }
  return positions
}
