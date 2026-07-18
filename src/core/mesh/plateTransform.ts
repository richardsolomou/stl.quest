import * as THREE from 'three'
import type { PlatePlacement } from '../platePlanner'

export type PlateMesh = {
  name: string
  positions: Float32Array
}

export function placementMatrix(placement: PlatePlacement, positions: Float32Array) {
  const orientation = new THREE.Quaternion(...(placement.orientationQuaternion ?? [0, 0, 0, 1]))
  const bounds = new THREE.Box3()
  const point = new THREE.Vector3()
  for (let index = 0; index < positions.length; index += 3) {
    point.set(positions[index], positions[index + 1], positions[index + 2]).applyQuaternion(orientation)
    bounds.expandByPoint(point)
  }
  const plateRotation = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1),
    THREE.MathUtils.degToRad(placement.rotationZDegrees),
  )
  const rotatedCenter = bounds.getCenter(new THREE.Vector3()).applyQuaternion(plateRotation)
  const position = new THREE.Vector3(placement.xMm - rotatedCenter.x, placement.yMm - rotatedCenter.y, -bounds.min.z)
  const rotation = plateRotation.multiply(orientation)
  return new THREE.Matrix4().compose(position, rotation, new THREE.Vector3(1, 1, 1))
}
