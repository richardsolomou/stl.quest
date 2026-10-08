import { Worker } from 'node:worker_threads'
import { expect, it } from 'vitest'

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

function runWorker(file: Uint8Array) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), {
      workerData: { file, wants: { thumbnail: false, preview: false } },
      transferList: [file.buffer as ArrayBuffer],
      execArgv: ['--import', 'tsx'],
      resourceLimits: { maxOldGenerationSizeMb: 64 },
    })
    worker.once('message', resolve)
    worker.once('error', reject)
  })
}

it('generates geometry for a large ASCII STL within a heap smaller than the file', async () => {
  const file = gridAsciiStl(500)
  await expect(runWorker(file)).resolves.toMatchObject({ ok: true, modelDimensions: { widthMm: 50, depthMm: 50, heightMm: 6 } })
}, 60_000)
