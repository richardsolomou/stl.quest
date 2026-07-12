// Software renderer for card thumbnails: perspective projection, z-buffer,
// flat shading. Mirrors the browser viewer's look (same camera framing,
// hemisphere + key light, material color) without any GL dependency.

const FOV_DEGREES = 40
// Camera offset direction from the old three.js framing, deliberately
// unnormalized to reproduce the same eye position.
const EYE_DIRECTION = [0.6, 0.5, 0.65] as const
const LIGHT = normalize([1, 1.5, 1])
const BASE_COLOR = [0.722, 0.698, 0.643] // 0xb8b2a4
const SKY = [0.957, 0.937, 0.886] // 0xf4efe2
const GROUND = [0.165, 0.173, 0.2] // 0x2a2c33
const HEMISPHERE_INTENSITY = 1.1
const KEY_INTENSITY = 1.4
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
  const radius = Math.hypot(
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  ) / 2 || 1

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
      const relative = [world[base] - eye[0], world[base + 1] - eye[1], world[base + 2] - eye[2]]
      const z = relative[0] * forward[0] + relative[1] * forward[1] + relative[2] * forward[2]
      if (z <= 0) { behind = true; break }
      const x = relative[0] * right[0] + relative[1] * right[1] + relative[2] * right[2]
      const y = relative[0] * up[0] + relative[1] * up[1] + relative[2] * up[2]
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
    let normal = normalize([uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx])
    const toEye = [eye[0] - world[base], eye[1] - world[base + 1], eye[2] - world[base + 2]]
    if (normal[0] * toEye[0] + normal[1] * toEye[1] + normal[2] * toEye[2] < 0) {
      normal = [-normal[0], -normal[1], -normal[2]]
    }
    const hemisphereMix = (normal[1] + 1) / 2
    const key = KEY_INTENSITY * Math.max(0, normal[0] * LIGHT[0] + normal[1] * LIGHT[1] + normal[2] * LIGHT[2])
    const shade = [0, 1, 2].map((channel) => {
      const hemisphere = (GROUND[channel] + (SKY[channel] - GROUND[channel]) * hemisphereMix) * HEMISPHERE_INTENSITY
      const linear = BASE_COLOR[channel] * (hemisphere + key) * EXPOSURE
      // Reinhard keeps highlights from clipping flat.
      return linear / (1 + linear * 0.35)
    })
    const red = Math.round(shade[0] * 255)
    const green = Math.round(shade[1] * 255)
    const blue = Math.round(shade[2] * 255)

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
      let red = 0, green = 0, blue = 0, alpha = 0
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
