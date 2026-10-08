import { STLLoader } from 'three-stdlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InvalidMeshError, parseStl } from './stl'

function loaderPositions(file: Uint8Array) {
  const geometry = new STLLoader().parse(file.slice().buffer)
  const position = geometry.getAttribute('position')
  if (!position || position.count === 0) return undefined
  geometry.center()
  return new Float32Array(position.array)
}

const NBSP = String.fromCodePoint(0xa0)
const BOM = String.fromCodePoint(0xfeff)
const UNICODE_NAME = ` pi\u00e8ce ${String.fromCodePoint(0x1f642)}`
const TRIANGLE = 'facet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\n'

function binaryStl(header: string, declaredTriangles: number, triangles: number[][]) {
  const file = new Uint8Array(84 + triangles.length * 50)
  file.set(new TextEncoder().encode(header).subarray(0, 80))
  const view = new DataView(file.buffer)
  view.setUint32(80, declaredTriangles, true)
  triangles.forEach((vertices, triangle) =>
    vertices.forEach((value, index) => view.setFloat32(84 + triangle * 50 + 12 + index * 4, value, true)),
  )
  return file
}

function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function randomAsciiStl(next: () => number) {
  const pick = <T>(values: T[]) => values[Math.floor(next() * values.length)]
  const gap = () => pick([' ', '  ', '\t', '\n', '\r\n', ' \n\t ', '\f\v ', `${NBSP} `])
  const number = () =>
    pick([
      () => String(Math.floor(next() * 200) - 100),
      () => (next() * 200 - 100).toFixed(Math.floor(next() * 7)),
      () => (next() * 200 - 100).toExponential(Math.floor(next() * 7)),
      () => (next() * 2e6 - 1e6).toExponential(6).toUpperCase(),
      () => `+${(next() * 10).toFixed(3)}`,
      () => `.${Math.floor(next() * 1000)}`,
      () => `${Math.floor(next() * 10)}.`,
      () => pick(['-0', '0', 'abc', '', '1e', '--1', 'NaN']),
    ])()
  const vertex = () => `vertex${gap()}${number()}${gap()}${number()}${gap()}${number()}`
  const facet = () => {
    const corners = Array.from({ length: next() < 0.9 ? 3 : pick([0, 1, 2, 4]) }, vertex)
    const normal = next() < 0.95 ? `normal${gap()}${number()}${gap()}${number()}${gap()}${number()}` : ''
    return `${pick(['facet', 'facet', 'facet', 'facte'])}${gap()}${normal}${gap()}outer loop${gap()}${corners.join(gap())}${gap()}endloop${gap()}${pick(['endfacet', 'endfacet', 'endfacet', 'endface'])}`
  }
  const solid = () => {
    const name = pick(['', ' part', ' faceted model', ' endfacet', UNICODE_NAME])
    const body = Array.from({ length: Math.floor(next() * 12) }, () => (next() < 0.05 ? vertex() : facet()))
    return `solid${name}${gap()}${body.join(gap())}${gap()}${next() < 0.9 ? `endsolid${name}` : ''}`
  }
  const lead = pick(['', ' ', '  ', BOM])
  const text = `${lead}${Array.from({ length: 1 + Math.floor(next() * 3) }, solid).join(gap())}${pick(['', '\n', 'trailing vertex 1 2 3'])}`
  return new TextEncoder().encode(text.padEnd(84, ' '))
}

describe('ASCII STL geometry', () => {
  beforeEach(() => {
    // The loader and Box3 report malformed faces and NaN bounds on the console.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('matches three-stdlib STLLoader positions for randomized ASCII files', () => {
    const next = random(371)
    for (let sample = 0; sample < 2000; sample++) {
      const file = randomAsciiStl(next)
      const expected = loaderPositions(file)
      if (!expected) {
        expect(() => parseStl(file)).toThrow(InvalidMeshError)
        continue
      }
      const actual = parseStl(file)
      // Element-wise Object.is: NaN payload sign bits vary with V8 optimization state, so bytes are not comparable.
      expect(Array.from(actual)).toEqual(Array.from(expected))
    }
  })

  it('matches STLLoader for more facets than the initial position buffer holds', () => {
    const facet = (index: number) =>
      `facet normal 0 0 1\nouter loop\nvertex ${index} 0 0\nvertex 1 ${index} 0\nvertex 0 1 ${index}\nendloop\nendfacet\n`
    const file = new TextEncoder().encode(`solid grid\n${Array.from({ length: 5000 }, (_, index) => facet(index)).join('')}endsolid grid\n`)
    expect(Array.from(parseStl(file))).toEqual(Array.from(loaderPositions(file)!))
  })

  it('rejects a truncated ASCII STL without endsolid', () => {
    const file = new TextEncoder().encode(
      'solid part\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\n',
    )
    expect(() => parseStl(file)).toThrow(InvalidMeshError)
  })

  it('rejects a facet too long to be STL data', () => {
    const file = new TextEncoder().encode(`solid part\nfacet ${' '.repeat(2 << 20)}vertex 0 0 0 endfacet\nendsolid part\n`)
    expect(() => parseStl(file)).toThrow(InvalidMeshError)
  })

  it('keeps binary STL with a mismatched size on the binary loader', () => {
    const file = new Uint8Array(84 + 50 + 7)
    new DataView(file.buffer).setUint32(80, 1, true)
    file.set(new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer), 84 + 12)
    expect(Array.from(parseStl(file))).toEqual(Array.from(loaderPositions(file)!))
  })
})

describe('STL format detection', () => {
  it('reads an ASCII STL with a UTF-8 solid name', () => {
    const file = new TextEncoder().encode(`solid${UNICODE_NAME}\n${TRIANGLE}endsolid${UNICODE_NAME}\n`)
    expect(Array.from(parseStl(file))).toEqual([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0])
  })

  it('reads an ASCII STL that starts with a byte order mark', () => {
    const file = new TextEncoder().encode(`${BOM}solid part\n${TRIANGLE}endsolid part\n`)
    expect(Array.from(parseStl(file))).toEqual([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0])
  })

  it.each([
    ['NUL padding', '\0\0\0\0'],
    ['a Ctrl-Z end-of-file marker', '\x1a'],
  ])('reads an ASCII STL that ends with %s', (_, tail) => {
    const file = new TextEncoder().encode(`solid part\n${TRIANGLE}endsolid part\n${tail}`)
    expect(Array.from(parseStl(file))).toEqual([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0])
  })

  it('reads a binary STL whose header starts with solid as binary', () => {
    const file = binaryStl('solid exported by a CAD tool', 1, [[0, 0, 0, 2, 0, 0, 0, 2, 0]])
    expect(Array.from(parseStl(file))).toEqual([-1, -1, 0, 1, -1, 0, -1, 1, 0])
  })

  it('rejects a truncated binary STL whose header starts with solid', () => {
    const file = binaryStl('solid exported by a CAD tool', 10, [[0, 0, 0, 2, 0, 0, 0, 2, 0]])
    expect(() => parseStl(file)).toThrow('invalid or truncated binary STL')
  })
})
