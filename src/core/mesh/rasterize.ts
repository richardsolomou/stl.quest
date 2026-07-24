import { MODEL_COLOR_RGB } from './appearance'

// Software renderer for card thumbnails: perspective projection, z-buffer,
// flat shading. Mirrors the browser viewer's look (same camera framing,
// hemisphere + key light, material color) without any GL dependency.

const FOV_DEGREES = 40
// Camera offset direction from the old three.js framing, deliberately
// unnormalized to reproduce the same eye position.
const EYE_DIRECTION = [0.6, 0.5, 0.65] as const
const LIGHT = normalize([1, 1.5, 1])
const SKY = [0.957, 0.937, 0.886] // 0xf4efe2
const GROUND = [0.165, 0.173, 0.2] // 0x2a2c33
const HEMISPHERE_INTENSITY = 1.1
const KEY_INTENSITY = 1.4
const AMBIENT_INTENSITY = 0.35
// Rough stand-in for the PBR renderer's energy handling and tone mapping;
// tuned by eye against the old WebGL thumbnails.
const EXPOSURE = 0.52
const SUPERSAMPLE = 2

function normalize(vector: readonly number[]): number[] {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1
  return [vector[0] / length, vector[1] / length, vector[2] / length]
}

/** Render centered STL positions (Z-up) to an RGBA thumbnail. */
export function rasterize(positions: Float32Array, size: number): Uint8Array {
  const raster = size * SUPERSAMPLE

  // STLs are Z-up; the viewer rotates -90° about X. (x, y, z) → (x, z, -y).
  const world = new Float32Array(positions.length)
  for (let index = 0; index < positions.length; index += 3) {
    world[index] = positions[index]
    world[index + 1] = positions[index + 2]
    world[index + 2] = -positions[index + 1]
  }

  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
  for (let index = 0; index < world.length; index += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = world[index + axis]
      if (value < bounds.min[axis]) bounds.min[axis] = value
      if (value > bounds.max[axis]) bounds.max[axis] = value
    }
  }
  const center = [0, 1, 2].map((axis) => (bounds.min[axis] + bounds.max[axis]) / 2)
  const radius = Math.hypot(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]) / 2 || 1

  const fov = (FOV_DEGREES * Math.PI) / 180
  const distance = (radius / Math.sin(fov / 2)) * 1.15
  const eye = [0, 1, 2].map((axis) => center[axis] + distance * EYE_DIRECTION[axis])
  const forward = normalize([center[0] - eye[0], center[1] - eye[1], center[2] - eye[2]])
  const right = normalize([-forward[2], 0, forward[0]]) // forward × worldUp(0,1,0)
  const up = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ]
  const focal = 1 / Math.tan(fov / 2)

  const pixels = new Uint8Array(raster * raster * 4)
  const depth = new Float32Array(raster * raster) // stores 1/z; larger is closer

  const screenX = new Float32Array(3)
  const screenY = new Float32Array(3)
  const inverseZ = new Float32Array(3)

  for (let triangle = 0; triangle < world.length / 9; triangle++) {
    let behind = false
    for (let corner = 0; corner < 3; corner++) {
      const base = triangle * 9 + corner * 3
      const relativeX = world[base] - eye[0]
      const relativeY = world[base + 1] - eye[1]
      const relativeZ = world[base + 2] - eye[2]
      const z = relativeX * forward[0] + relativeY * forward[1] + relativeZ * forward[2]
      if (z <= 0) {
        behind = true
        break
      }
      const x = relativeX * right[0] + relativeY * right[1] + relativeZ * right[2]
      const y = relativeX * up[0] + relativeY * up[1] + relativeZ * up[2]
      screenX[corner] = ((x / z) * focal + 1) * 0.5 * raster
      screenY[corner] = (1 - (y / z) * focal) * 0.5 * raster
      inverseZ[corner] = 1 / z
    }
    if (behind) continue

    const area = (screenX[1] - screenX[0]) * (screenY[2] - screenY[0]) - (screenY[1] - screenY[0]) * (screenX[2] - screenX[0])
    if (area === 0) continue

    // Flat shading with a double-sided normal so inverted winding still reads.
    const base = triangle * 9
    const ux = world[base + 3] - world[base]
    const uy = world[base + 4] - world[base + 1]
    const uz = world[base + 5] - world[base + 2]
    const vx = world[base + 6] - world[base]
    const vy = world[base + 7] - world[base + 1]
    const vz = world[base + 8] - world[base + 2]
    let normalX = uy * vz - uz * vy
    let normalY = uz * vx - ux * vz
    let normalZ = ux * vy - uy * vx
    const normalLength = Math.hypot(normalX, normalY, normalZ) || 1
    normalX /= normalLength
    normalY /= normalLength
    normalZ /= normalLength
    if (normalX * (eye[0] - world[base]) + normalY * (eye[1] - world[base + 1]) + normalZ * (eye[2] - world[base + 2]) < 0) {
      normalX = -normalX
      normalY = -normalY
      normalZ = -normalZ
    }
    const hemisphereMix = (normalY + 1) / 2
    const key = KEY_INTENSITY * Math.max(0, normalX * LIGHT[0] + normalY * LIGHT[1] + normalZ * LIGHT[2])
    const redLinear =
      MODEL_COLOR_RGB[0] * (AMBIENT_INTENSITY + (GROUND[0] + (SKY[0] - GROUND[0]) * hemisphereMix) * HEMISPHERE_INTENSITY + key) * EXPOSURE
    const greenLinear =
      MODEL_COLOR_RGB[1] * (AMBIENT_INTENSITY + (GROUND[1] + (SKY[1] - GROUND[1]) * hemisphereMix) * HEMISPHERE_INTENSITY + key) * EXPOSURE
    const blueLinear =
      MODEL_COLOR_RGB[2] * (AMBIENT_INTENSITY + (GROUND[2] + (SKY[2] - GROUND[2]) * hemisphereMix) * HEMISPHERE_INTENSITY + key) * EXPOSURE
    // Reinhard keeps highlights from clipping flat.
    const red = Math.round((redLinear / (1 + redLinear * 0.35)) * 255)
    const green = Math.round((greenLinear / (1 + greenLinear * 0.35)) * 255)
    const blue = Math.round((blueLinear / (1 + blueLinear * 0.35)) * 255)

    const minX = Math.max(0, Math.floor(Math.min(screenX[0], screenX[1], screenX[2])))
    const maxX = Math.min(raster - 1, Math.ceil(Math.max(screenX[0], screenX[1], screenX[2])))
    const minY = Math.max(0, Math.floor(Math.min(screenY[0], screenY[1], screenY[2])))
    const maxY = Math.min(raster - 1, Math.ceil(Math.max(screenY[0], screenY[1], screenY[2])))

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5
        const py = y + 0.5
        const w0 = ((screenX[1] - px) * (screenY[2] - py) - (screenY[1] - py) * (screenX[2] - px)) / area
        const w1 = ((screenX[2] - px) * (screenY[0] - py) - (screenY[2] - py) * (screenX[0] - px)) / area
        const w2 = 1 - w0 - w1
        if (w0 < 0 || w1 < 0 || w2 < 0) continue
        const z = w0 * inverseZ[0] + w1 * inverseZ[1] + w2 * inverseZ[2]
        const offset = y * raster + x
        if (z <= depth[offset]) continue
        depth[offset] = z
        pixels[offset * 4] = red
        pixels[offset * 4 + 1] = green
        pixels[offset * 4 + 2] = blue
        pixels[offset * 4 + 3] = 255
      }
    }
  }

  return downsample(pixels, raster, size)
}

function downsample(pixels: Uint8Array, from: number, to: number): Uint8Array {
  const factor = from / to
  const output = new Uint8Array(to * to * 4)
  for (let y = 0; y < to; y++) {
    for (let x = 0; x < to; x++) {
      let red = 0,
        green = 0,
        blue = 0,
        alpha = 0
      for (let sy = 0; sy < factor; sy++) {
        for (let sx = 0; sx < factor; sx++) {
          const source = ((y * factor + sy) * from + x * factor + sx) * 4
          const weight = pixels[source + 3] / 255
          red += pixels[source] * weight
          green += pixels[source + 1] * weight
          blue += pixels[source + 2] * weight
          alpha += pixels[source + 3]
        }
      }
      const samples = factor * factor
      const coverage = alpha / (samples * 255)
      const target = (y * to + x) * 4
      if (coverage > 0) {
        output[target] = Math.round(red / (samples * coverage))
        output[target + 1] = Math.round(green / (samples * coverage))
        output[target + 2] = Math.round(blue / (samples * coverage))
        output[target + 3] = Math.round(alpha / samples)
      }
    }
  }
  return output
}
