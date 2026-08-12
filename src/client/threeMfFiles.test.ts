import { describe, expect, it } from 'vitest'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { inspectThreeMfBytes, splitThreeMf } from './threeMfFiles'
import { parseThreeMf } from '../core/mesh/threeMf'

const model = `<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Title">Assembly</metadata><resources>
<object id="1" name="Wheel" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
<object id="2" name="Wheel" type="model"><components><component objectid="1"/></components></object>
</resources><build><item objectid="1"/><item objectid="2" transform="1 0 0 0 1 0 0 0 1 5 0 0"/><item objectid="2" transform="1 0 0 0 1 0 0 0 1 10 0 0"/></build></model>`

function assembly() {
  return new File([zipSync({ '[Content_Types].xml': strToU8('<Types/>'), '3D/model.model': strToU8(model) })], 'car.3mf', {
    type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml',
  })
}

describe('3MF upload splitting', () => {
  it('detects top-level build items', async () => {
    expect(inspectThreeMfBytes(new Uint8Array(await assembly().arrayBuffer()))).toMatchObject({ itemCount: 3, requestCount: 2 })
  })

  it('creates independently valid archives and preserves project metadata', async () => {
    const progress: [number, number][] = []
    const parts = await splitThreeMf(assembly(), (completed, total) => progress.push([completed, total]))
    expect(parts.map((part) => ({ name: part.file.name, quantity: part.quantity }))).toEqual([
      { name: 'car - Wheel.3mf', quantity: 1 },
      { name: 'car - Wheel 2.3mf', quantity: 2 },
    ])
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ])
    for (const part of parts) {
      const bytes = new Uint8Array(await part.file.arrayBuffer())
      expect(parseThreeMf(bytes).length).toBe(9)
      const archive = unzipSync(bytes)
      expect(new TextDecoder().decode(archive['3D/model.model'])).toContain('<metadata name="Title">Assembly</metadata>')
      expect(new TextDecoder().decode(archive['3D/model.model']).match(/<item\b/g)).toHaveLength(1)
    }
  })
})
