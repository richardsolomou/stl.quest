import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { XMLParser } from 'fast-xml-parser'
import { parseThreeMf } from './threeMf'
import {
  arrangeFootprints,
  plateMesh,
  THREE_MF_CONTENT_TYPES,
  THREE_MF_RELATIONSHIPS,
  threeMfBuildXml,
  threeMfModelEnd,
  threeMfModelStart,
  threeMfObjectXml,
} from './threeMfWriter'

// Two triangles sharing an edge: a 10 × 4 quad lifted 3 above the origin.
const quad = new Float32Array([0, 0, 3, 10, 0, 3, 10, 4, 3, 0, 0, 3, 10, 4, 3, 0, 4, 3])

describe('plateMesh', () => {
  it('shares the corners triangles have in common', () => {
    expect(plateMesh(quad).vertices.length / 3).toBe(4)
  })

  it('keeps every triangle', () => {
    expect(plateMesh(quad).triangles.length / 3).toBe(2)
  })

  it('stands the model on the bed', () => {
    const { vertices } = plateMesh(quad)
    expect(Math.min(...vertices.filter((_, index) => index % 3 === 2))).toBe(0)
  })

  it('centres the model over the origin', () => {
    const { vertices } = plateMesh(quad)
    const xs = vertices.filter((_, index) => index % 3 === 0)
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([-5, 5])
  })

  it('measures the footprint', () => {
    expect(plateMesh(quad)).toMatchObject({ width: 10, depth: 4 })
  })

  it('drops triangles whose corners coincide', () => {
    const sliver = new Float32Array([...quad, 1, 1, 3, 1, 1, 3, 2, 2, 3])
    expect(plateMesh(sliver).triangles.length / 3).toBe(2)
  })

  it('treats negative zero as zero', () => {
    const signed = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, -0, 0, 0, 0, 1, 0, 1, 0, 0])
    expect(plateMesh(signed).vertices.length / 3).toBe(3)
  })
})

describe('arrangeFootprints', () => {
  it('keeps every footprint apart', () => {
    const footprints = [10, 20, 5, 30, 12].map((size) => ({ width: size, depth: size }))
    const placed = arrangeFootprints(footprints, 5)
    const overlaps = placed.some((a, i) =>
      placed.some(
        (b, j) =>
          i < j &&
          Math.abs(a.x - b.x) < (footprints[i].width + footprints[j].width) / 2 + 5 &&
          Math.abs(a.y - b.y) < (footprints[i].depth + footprints[j].depth) / 2 + 5,
      ),
    )
    expect(overlaps).toBe(false)
  })

  it('lays copies out in rows rather than one long line', () => {
    const placed = arrangeFootprints(
      Array.from({ length: 9 }, () => ({ width: 10, depth: 10 })),
      5,
    )
    expect(new Set(placed.map(({ y }) => y)).size).toBe(3)
  })

  it('keeps the layout on the positive side of the bed', () => {
    const placed = arrangeFootprints([{ width: 10, depth: 6 }], 5)
    expect(placed).toEqual([{ x: 10, y: 8 }])
  })
})

describe('threeMfObjectXml', () => {
  it('drops control characters XML cannot carry', () => {
    expect([...threeMfObjectXml(1, 'SQ-3 bell\u0007.stl', plateMesh(quad))].join('')).toContain('name="SQ-3 bell.stl"')
  })

  it('escapes the object name', () => {
    expect([...threeMfObjectXml(1, 'SQ-3 <Tom & "Jerry">.stl', plateMesh(quad))].join('')).toContain(
      'name="SQ-3 &lt;Tom &amp; &quot;Jerry&quot;&gt;.stl"',
    )
  })
})

describe('a written plate file', () => {
  const file = () => {
    const mesh = plateMesh(quad)
    const model = [
      threeMfModelStart(),
      ...threeMfObjectXml(1, 'SQ-7 hull.stl', mesh),
      ...threeMfObjectXml(2, 'SQ-8 turret.stl', mesh),
      threeMfBuildXml([
        { objectId: 1, x: 10, y: 10 },
        { objectId: 1, x: 30, y: 10 },
        { objectId: 2, x: 50, y: 10 },
      ]),
      threeMfModelEnd(),
    ].join('')
    return {
      model,
      archive: zipSync({
        '[Content_Types].xml': strToU8(THREE_MF_CONTENT_TYPES),
        '_rels/.rels': strToU8(THREE_MF_RELATIONSHIPS),
        '3D/3dmodel.model': strToU8(model),
      }),
    }
  }
  const parsed = () =>
    new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' }).parse(file().model) as {
      model: { resources: { object: { id: string; name: string }[] }; build: { item: { objectid: string; transform: string }[] } }
    }

  it('reads back as every copy of every model', () => {
    expect(parseThreeMf(file().archive).length / 9).toBe(6)
  })

  it('names each object after its request', () => {
    expect(parsed().model.resources.object.map(({ name }) => name)).toEqual(['SQ-7 hull.stl', 'SQ-8 turret.stl'])
  })

  it('places one build item per copy', () => {
    expect(parsed().model.build.item.map(({ objectid }) => objectid)).toEqual(['1', '1', '2'])
  })

  it('moves each copy to its place on the bed', () => {
    expect(parsed().model.build.item[1].transform).toBe('1 0 0 0 1 0 0 0 1 30 10 0')
  })
})
