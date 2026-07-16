import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import { InvalidThreeMfError, validateThreeMf, validateThreeMfFile } from './modelValidation'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.promises.rm(root, { recursive: true, force: true })))
})

function validThreeMf() {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rel0" Target="/3D/model.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
    ),
    '3D/model.model': strToU8(
      '<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>',
    ),
  })
}

describe('validateThreeMfFile', () => {
  it('validates a staged upload', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-validation-'))
    roots.push(root)
    const file = path.join(root, 'model.3mf')
    await fs.promises.writeFile(file, validThreeMf())

    await expect(validateThreeMfFile(file, { inline: true })).resolves.toBeUndefined()
  })

  it('distinguishes invalid archives from storage failures', async () => {
    await expect(validateThreeMf(new TextEncoder().encode('not a zip'), { inline: true })).rejects.toBeInstanceOf(InvalidThreeMfError)
    await expect(validateThreeMfFile('/missing/model.3mf', { inline: true })).rejects.not.toBeInstanceOf(InvalidThreeMfError)
  })

  it('reports worker crashes', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-validation-worker-'))
    roots.push(root)
    const workerPath = path.join(root, 'invalid-worker.mjs')
    await fs.promises.writeFile(workerPath, "throw new Error('worker crashed')")

    await expect(validateThreeMf(new Uint8Array([1]), { path: workerPath })).rejects.toThrow('worker crashed')
  })

  it('rejects a clean worker exit without a result', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-validation-worker-exit-'))
    roots.push(root)
    const workerPath = path.join(root, 'empty-worker.mjs')
    await fs.promises.writeFile(workerPath, '')

    await expect(validateThreeMf(new Uint8Array([1]), { path: workerPath })).rejects.toThrow('exited with code 0 before returning a result')
  })
})
