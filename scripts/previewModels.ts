import * as THREE from 'three'
import { exportBinaryStl } from '../src/core/mesh/stl'

// Generated rather than vendored: previews need real geometry so thumbnails, the viewer, and
// dimension checks behave like production, and generating it avoids shipping third-party models.
const shapes = {
  cube: () => new THREE.BoxGeometry(20, 20, 20),
  bracket: () => new THREE.ExtrudeGeometry(bracketProfile(), { depth: 6, bevelEnabled: false }),
  figure: () => new THREE.LatheGeometry(figureProfile(), 48),
} as const

export type PreviewShape = keyof typeof shapes

export function previewModelStl(shape: PreviewShape): Uint8Array {
  const geometry = shapes[shape]()
  try {
    const position = geometry.getAttribute('position')
    const index = geometry.getIndex()
    const indices = index ? new Uint32Array(index.array) : new Uint32Array(Array.from({ length: position.count }, (_, vertex) => vertex))
    return exportBinaryStl(new Float32Array(position.array), indices)
  } finally {
    geometry.dispose()
  }
}

// An L-plate with two mounting holes, which is what a replacement bracket usually is.
function bracketProfile() {
  const shape = new THREE.Shape()
  shape.moveTo(0, 0)
  shape.lineTo(40, 0)
  shape.lineTo(40, 10)
  shape.lineTo(10, 10)
  shape.lineTo(10, 34)
  shape.lineTo(0, 34)
  shape.closePath()
  for (const [x, y] of [
    [30, 5],
    [5, 28],
  ] as const) {
    const hole = new THREE.Path()
    hole.absarc(x, y, 2.5, 0, Math.PI * 2, true)
    shape.holes.push(hole)
  }
  return shape
}

// Revolved silhouette of a pawn-sized tabletop figure: base, stem, then a rounded head.
function figureProfile() {
  const points: THREE.Vector2[] = [new THREE.Vector2(0, 0), new THREE.Vector2(9, 0), new THREE.Vector2(9, 2), new THREE.Vector2(5, 4)]
  for (let step = 0; step <= 8; step++) {
    const t = step / 8
    points.push(new THREE.Vector2(3.4 - 1.4 * Math.sin(t * Math.PI), 4 + t * 14))
  }
  for (let step = 0; step <= 10; step++) {
    const angle = (step / 10) * (Math.PI / 2)
    points.push(new THREE.Vector2(Math.cos(angle) * 5.5, 18 + Math.sin(angle) * 5.5))
  }
  return points
}
