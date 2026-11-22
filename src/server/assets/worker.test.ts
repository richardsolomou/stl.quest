import { Worker } from 'node:worker_threads'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { slicedFileBomb, slicedPlateFile } from '../../../e2e/fixtures/slicedPlate'

function gridObj(size: number) {
  const lines: string[] = []
  for (let y = 0; y <= size; y++) for (let x = 0; x <= size; x++) lines.push(`v ${x * 0.1} ${y * 0.1} ${(x * y) % 7}`)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const corner = y * (size + 1) + x + 1
      lines.push(`f ${corner} ${corner + 1} ${corner + size + 2} ${corner + size + 1}`)
    }
  return new TextEncoder().encode(lines.join('\n'))
}

function gridAsciiStl(size: number) {
  const vertex = (x: number, y: number) => `      vertex ${x / 10} ${y / 10} ${(x * y) % 7}\n`
  const facet = (corners: string) => `  facet normal 0 0 1\n    outer loop\n${corners}    endloop\n  endfacet\n`
  const facets: string[] = ['solid grid\n']
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      facets.push(facet(vertex(x, y) + vertex(x + 1, y) + vertex(x + 1, y + 1)))
      facets.push(facet(vertex(x, y) + vertex(x + 1, y + 1) + vertex(x, y + 1)))
    }
  facets.push('endsolid grid\n')
  return new TextEncoder().encode(facets.join(''))
}

function runWorker(file: Uint8Array, job: Record<string, unknown> = { mode: 'visual', wants: { thumbnail: false, preview: false } }) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), {
      workerData: { file, ...job },
      transferList: [file.buffer as ArrayBuffer],
      execArgv: ['--import', 'tsx'],
      resourceLimits: { maxOldGenerationSizeMb: 64 },
    })
    worker.once('message', resolve)
    worker.once('error', reject)
  })
}

it('generates geometry for a large OBJ within a heap smaller than the file', async () => {
  await expect(runWorker(gridObj(1000))).resolves.toMatchObject({ ok: true, modelDimensions: { widthMm: 100, depthMm: 100, heightMm: 6 } })
}, 60_000)

it('generates geometry for a large ASCII STL within a heap smaller than the file', async () => {
  await expect(runWorker(gridAsciiStl(500))).resolves.toMatchObject({
    ok: true,
    modelDimensions: { widthMm: 50, depthMm: 50, heightMm: 6 },
  })
}, 60_000)

it('converts a large OBJ into a plate object within a heap smaller than the file', async () => {
  const xmlPath = path.join(await fs.promises.mkdtemp(path.join(os.tmpdir(), 'plate-worker-')), '3dmodel.model')
  try {
    await expect(runWorker(gridObj(1000), { mode: 'plate', object: { id: 1, name: 'SQ-1 grid.obj' }, xmlPath })).resolves.toEqual({
      ok: true,
      stage: 'complete',
      width: 100,
      depth: 100,
    })
  } finally {
    await fs.promises.rm(path.dirname(xmlPath), { recursive: true, force: true })
  }
}, 60_000)

it('reads a sliced file', async () => {
  const file = slicedPlateFile({ objects: [{ id: '1', name: 'Hull.stl', extrusionMm: 100 }] })
  await expect(runWorker(file, { mode: 'sliced' })).resolves.toMatchObject({
    ok: true,
    plates: [{ index: 1, objects: [{ id: '1', name: 'Hull.stl' }] }],
  })
})

it('refuses a sliced file that inflates past its limits within a heap far smaller than it', async () => {
  const bomb = slicedFileBomb([{ name: 'Metadata/plate_1.gcode', text: 'G1 E1\n'.repeat(1 << 18), repeats: 4096, declaredBytes: 1 << 20 }])
  await expect(runWorker(bomb, { mode: 'sliced' })).resolves.toMatchObject({ ok: false, slicedFile: true })
})
