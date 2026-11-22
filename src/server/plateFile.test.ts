import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { MAX_PLATE_FILE_BYTES } from '../core/plates'
import { parseThreeMf } from '../core/mesh/threeMf'
import { type PlateObject, writePlateObject } from './assets/plateObject'
import { checkedPlateModels, MAX_CACHED_PLATES, PlateFiles, PlateModelError, sweepPlateDirectories } from './plateFile'

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

/** A binary STL of `count` separate triangles, enough to outgrow every buffer between the build and the client. */
function triangles(count: number) {
  const file = new DataView(new ArrayBuffer(84 + count * 50))
  file.setUint32(80, count, true)
  for (let index = 0; index < count; index++)
    for (const [corner, [x, y]] of [
      [0, 0],
      [1, 0],
      [0, 1],
    ].entries()) {
      file.setFloat32(84 + index * 50 + 12 + corner * 12, x + index, true)
      file.setFloat32(84 + index * 50 + 16 + corner * 12, y, true)
    }
  return new Uint8Array(file.buffer)
}

const files = new Map([
  ['todo/hull.stl', triangle],
  ['todo/turret.stl', triangle],
  ['todo/big.stl', triangles(300_000)],
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
  { requestId: 'hull', name: 'SQ-7 hull.stl', path: 'todo/hull.stl', copies: 2, updatedAt: 0 },
  { requestId: 'turret', name: 'SQ-8 turret.stl', path: 'todo/turret.stl', copies: 1, updatedAt: 0 },
]

function context(listed = models) {
  return {
    assets,
    identity: { role: 'admin' as const },
    service: { plateModels: async () => ({ plate: { number: 3 }, models: listed, skipped: 0 }) },
  }
}

/** Converts in process, as the asset queue does under tests, counting the models it converts. */
function plateFiles(keepMs?: number, before: () => Promise<void> = async () => undefined) {
  const converted: string[] = []
  const converter = {
    writePlateObject: async (path: string, object: PlateObject, xmlPath: string) => {
      converted.push(path)
      await before()
      return writePlateObject(files.get(path)!, object, xmlPath)
    },
  }
  return { files: new PlateFiles(converter, keepMs), converted }
}

const opened: PlateFiles[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(opened.splice(0).map((plates) => plates.close()))
})

function within<T>(promise: Promise<T>, ms = 2000) {
  return Promise.race([promise.then(() => 'settled'), new Promise((resolve) => setTimeout(resolve, ms, 'stuck'))])
}

async function bytes(listed = models) {
  const { files: plates } = plateFiles()
  opened.push(plates)
  return new Uint8Array(await new Response((await plates.open('plate', listed)).stream).arrayBuffer())
}

async function written() {
  const archive = unzipSync(await bytes())
  return { archive, model: strFromU8(archive['3D/3dmodel.model']) }
}

const bigPlate = [{ requestId: 'big', name: 'SQ-5 big.stl', path: 'todo/big.stl', copies: 1, updatedAt: 0 }]

describe('PlateFiles', () => {
  it('holds every copy of every model', async () => {
    expect(parseThreeMf(await bytes()).length / 9).toBe(3)
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

  it('refuses the plate before sending anything when a model cannot be read as a mesh', async () => {
    files.set('todo/broken.stl', new TextEncoder().encode('not a mesh'))
    await expect(
      bytes([{ requestId: 'broken', name: 'SQ-9 broken.stl', path: 'todo/broken.stl', copies: 1, updatedAt: 0 }]),
    ).rejects.toMatchObject({
      model: { requestId: 'broken' },
    })
  })

  it('refuses a model with no triangle that has any area', async () => {
    files.set('todo/flat.stl', new TextEncoder().encode(new TextDecoder().decode(triangle).replace('vertex 10 0 0', 'vertex 0 0 0')))
    await expect(
      bytes([{ requestId: 'flat', name: 'SQ-6 flat.stl', path: 'todo/flat.stl', copies: 1, updatedAt: 0 }]),
    ).rejects.toBeInstanceOf(PlateModelError)
  })

  it('leaves no temporary file behind when a build fails', async () => {
    const before = await plateDirectories()
    await bytes([{ requestId: 'broken', name: 'SQ-9 broken.stl', path: 'todo/broken.stl', copies: 1, updatedAt: 0 }]).catch(() => undefined)
    expect(await plateDirectories()).toEqual(before)
  })

  it('reuses a plate file it already built', async () => {
    const { files: plates, converted } = plateFiles()
    opened.push(plates)
    await new Response((await plates.open('plate', models)).stream).arrayBuffer()
    await new Response((await plates.open('plate', models)).stream).arrayBuffer()
    expect(converted).toHaveLength(models.length)
  })

  it('rebuilds a plate whose prints changed', async () => {
    const { files: plates, converted } = plateFiles()
    opened.push(plates)
    await new Response((await plates.open('plate', models)).stream).arrayBuffer()
    await new Response((await plates.open('plate', models.slice(1))).stream).arrayBuffer()
    expect(converted).toHaveLength(models.length + 1)
  })

  it('removes a plate file once its link has expired', async () => {
    const before = await plateDirectories()
    const { files: plates } = plateFiles(20)
    opened.push(plates)
    await new Response((await plates.open('plate', models)).stream).arrayBuffer()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(await plateDirectories()).toEqual(before)
  })

  it('closes while a build runs and another waits', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { files: plates } = plateFiles(undefined, () => gate)
    const running = plates.open('plate', models).catch(() => undefined)
    const queued = plates.open('plate', models.slice(1)).catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 20))
    const closing = plates.close()
    release()
    await expect(within(Promise.all([closing, running, queued]))).resolves.toBe('settled')
  })

  it('rebuilds a plate file that expired while it was being opened', async () => {
    const { files: plates } = plateFiles(20)
    opened.push(plates)
    await new Response((await plates.open('plate', models)).stream).arrayBuffer()
    const open = fs.promises.open
    vi.spyOn(fs.promises, 'open').mockImplementationOnce(async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 100))
      return await open(...args)
    })
    expect(parseThreeMf(new Uint8Array(await new Response((await plates.open('plate', models)).stream).arrayBuffer())).length / 9).toBe(3)
  })

  it('keeps only the most recent plate files', async () => {
    const before = await plateDirectories()
    const { files: plates } = plateFiles()
    opened.push(plates)
    for (let copies = 1; copies <= MAX_CACHED_PLATES + 2; copies++)
      await new Response((await plates.open('plate', [{ ...models[1], copies }])).stream).arrayBuffer()
    // Eviction removes the oldest file in the background, so the count settles shortly after the last open.
    await expect.poll(async () => (await plateDirectories()).filter((name) => !before.includes(name))).toHaveLength(MAX_CACHED_PLATES)
  })

  it('does not hold up the next plate while a download is paused', async () => {
    const { files: plates } = plateFiles()
    opened.push(plates)
    const paused = (await plates.open('big', bigPlate)).stream.getReader()
    await paused.read()
    const next = plates.open('plate', models).then(({ stream }) => new Response(stream).arrayBuffer())
    await expect(Promise.race([next.then(() => 'built'), new Promise((resolve) => setTimeout(resolve, 2000, 'stuck'))])).resolves.toBe(
      'built',
    )
    await paused.cancel()
  })
})

async function plateDirectories() {
  return (await fs.promises.readdir(os.tmpdir())).filter((name) => name.startsWith('stlquest-plate-')).sort()
}

describe('sweepPlateDirectories', () => {
  async function directory(name: string, ageMs: number) {
    const made = join(os.tmpdir(), name)
    await fs.promises.mkdir(made, { recursive: true })
    const at = new Date(Date.now() - ageMs)
    await fs.promises.utimes(made, at, at)
    return made
  }

  afterEach(async () => {
    for (const name of ['stlquest-plate-swept', 'stlquest-plate-fresh', 'other-plate-swept'])
      await fs.promises.rm(join(os.tmpdir(), name), { recursive: true, force: true })
  })

  it('removes plate files older than their links', async () => {
    await directory('stlquest-plate-swept', 60_000)
    await sweepPlateDirectories(30_000)
    expect(await plateDirectories()).not.toContain('stlquest-plate-swept')
  })

  it('keeps plate files whose links may still work', async () => {
    await directory('stlquest-plate-fresh', 0)
    await sweepPlateDirectories(30_000)
    expect(await plateDirectories()).toContain('stlquest-plate-fresh')
  })

  it('keeps other temporary files', async () => {
    const other = await directory('other-plate-swept', 60_000)
    await sweepPlateDirectories(30_000)
    expect(fs.existsSync(other)).toBe(true)
  })
})

describe('checkedPlateModels', () => {
  it('sums the copies on the plate', async () => {
    expect(await checkedPlateModels(context(), 'plate')).toMatchObject({ copies: 3 })
  })

  it('refuses a model missing from storage', async () => {
    await expect(
      checkedPlateModels(context([{ requestId: 'gone', name: 'SQ-1 gone.stl', path: 'todo/gone.stl', copies: 1, updatedAt: 0 }]), 'plate'),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('refuses models that add up to more than one plate file holds', async () => {
    sizes.set('todo/huge.stl', MAX_PLATE_FILE_BYTES / 2 + 1)
    const huge = { requestId: 'huge', name: 'SQ-2 huge.stl', path: 'todo/huge.stl', copies: 4, updatedAt: 0 }
    await expect(checkedPlateModels(context([huge, { ...huge, requestId: 'again' }]), 'plate')).rejects.toMatchObject({ status: 413 })
  })

  it('counts a model once however many copies it has', async () => {
    sizes.set('todo/big.stl', MAX_PLATE_FILE_BYTES / 2)
    const big = { requestId: 'big', name: 'SQ-4 big.stl', path: 'todo/big.stl', copies: 4, updatedAt: 0 }
    expect(await checkedPlateModels(context([big]), 'plate')).toMatchObject({ copies: 4 })
  })
})
