import { Worker } from 'node:worker_threads'
import { expect, it } from 'vitest'

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

it('generates geometry for a large OBJ within a heap smaller than the file', async () => {
  const file = gridObj(1000)
  const reply = await new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), {
      workerData: { file, wants: { thumbnail: false, preview: false } },
      transferList: [file.buffer],
      execArgv: ['--import', 'tsx'],
      resourceLimits: { maxOldGenerationSizeMb: 64 },
    })
    worker.once('message', resolve)
    worker.once('error', reject)
  })
  expect(reply).toMatchObject({ ok: true, modelDimensions: { widthMm: 100, depthMm: 100, heightMm: 6 } })
}, 60_000)
