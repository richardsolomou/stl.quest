import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { MAX_PLATE_FILE_BYTES } from '../core/plates'
import { parseThreeMf } from '../core/mesh/threeMf'
import { checkedPlateModels, plateThreeMf } from './plateFile'

// One triangle in ASCII STL, so any two files differ only by name.
const triangle = new TextEncoder().encode(`solid t
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 10 0 0
vertex 0 10 0
endloop
endfacet
endsolid t
`)

const files = new Map([
  ['todo/hull.stl', triangle],
  ['todo/turret.stl', triangle],
])

// Sizes stand in for files too large to keep in a test.
const sizes = new Map<string, number>()

const assets = {
  stat: async (path: string) => {
    const size = sizes.get(path) ?? files.get(path)?.byteLength
    return size === undefined ? undefined : { size }
  },
  read: async (path: string) => ({ stream: new Blob([files.get(path)!]).stream(), size: files.get(path)!.byteLength }),
}

const models = [
  { requestId: 'hull', name: 'SQ-7 hull.stl', path: 'todo/hull.stl', copies: 2 },
  { requestId: 'turret', name: 'SQ-8 turret.stl', path: 'todo/turret.stl', copies: 1 },
]

function context(listed = models) {
  return {
    assets,
    identity: { role: 'admin' as const },
    service: { plateModels: async () => ({ plate: { number: 3 }, models: listed, skipped: 0 }) },
  }
}

async function written() {
  const archive = unzipSync(new Uint8Array(await new Response(plateThreeMf(assets, models)).arrayBuffer()))
  return { archive, model: strFromU8(archive['3D/3dmodel.model']) }
}

describe('plateThreeMf', () => {
  it('holds every copy of every model', async () => {
    const bytes = new Uint8Array(await new Response(plateThreeMf(assets, models)).arrayBuffer())
    expect(parseThreeMf(bytes).length / 9).toBe(3)
  })

  it('has the parts the 3MF core specification requires', async () => {
    expect(Object.keys((await written()).archive).sort()).toEqual(['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels'])
  })

  it('names each object after its request', async () => {
    expect([...(await written()).model.matchAll(/<object id="\d+" name="([^"]+)"/g)].map((match) => match[1])).toEqual([
      'SQ-7 hull.stl',
      'SQ-8 turret.stl',
    ])
  })

  it('places each copy as its own build item', async () => {
    expect([...(await written()).model.matchAll(/<item objectid="(\d+)"/g)].map((match) => match[1])).toEqual(['1', '1', '2'])
  })

  it('fails the download when a model cannot be read as a mesh', async () => {
    files.set('todo/broken.stl', new TextEncoder().encode('not a mesh'))
    const stream = plateThreeMf(assets, [{ requestId: 'broken', name: 'SQ-9 broken.stl', path: 'todo/broken.stl', copies: 1 }])
    await expect(new Response(stream).arrayBuffer()).rejects.toThrow()
  })
})

describe('checkedPlateModels', () => {
  it('sums the copies on the plate', async () => {
    expect(await checkedPlateModels(context(), 'plate')).toMatchObject({ copies: 3 })
  })

  it('refuses a model missing from storage', async () => {
    await expect(
      checkedPlateModels(context([{ requestId: 'gone', name: 'SQ-1 gone.stl', path: 'todo/gone.stl', copies: 1 }]), 'plate'),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('refuses models that add up to more than one plate file holds', async () => {
    sizes.set('todo/huge.stl', MAX_PLATE_FILE_BYTES / 2 + 1)
    const huge = { requestId: 'huge', name: 'SQ-2 huge.stl', path: 'todo/huge.stl', copies: 4 }
    await expect(checkedPlateModels(context([huge, { ...huge, requestId: 'again' }]), 'plate')).rejects.toMatchObject({ status: 413 })
  })

  it('counts a model once however many copies it has', async () => {
    sizes.set('todo/big.stl', MAX_PLATE_FILE_BYTES / 2)
    const big = { requestId: 'big', name: 'SQ-4 big.stl', path: 'todo/big.stl', copies: 4 }
    expect(await checkedPlateModels(context([big]), 'plate')).toMatchObject({ copies: 4 })
  })
})
