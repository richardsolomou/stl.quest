import { describe, expect, it } from 'vitest'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { inspectThreeMf, splitThreeMf } from './threeMfFiles'
import { parseThreeMf } from '../core/mesh/threeMf'

const model = `<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Title">Assembly</metadata><resources>
<object id="1" name="Wheel" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
<object id="2" name="Wheel" type="model"><components><component objectid="1"/></components></object>
</resources><build><item objectid="1"/><item objectid="2" transform="1 0 0 0 1 0 0 0 1 5 0 0"/></build></model>`

function assembly() {
  return new File([zipSync({ '[Content_Types].xml': strToU8('<Types/>'), '3D/model.model': strToU8(model) })], 'car.3mf', {
    type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml',
  })
}

describe('3MF upload splitting', () => {
  it('detects top-level build items', async () => {
    await expect(inspectThreeMf(assembly())).resolves.toMatchObject({ itemCount: 2 })
  })

  it('creates independently valid archives and preserves project metadata', async () => {
    const parts = await splitThreeMf(assembly())
    expect(parts.map((part) => part.name)).toEqual(['car - Wheel.3mf', 'car - Wheel 2.3mf'])
    for (const part of parts) {
      const bytes = new Uint8Array(await part.arrayBuffer())
      expect(parseThreeMf(bytes).length).toBe(9)
      const archive = unzipSync(bytes)
      expect(new TextDecoder().decode(archive['3D/model.model'])).toContain('<metadata name="Title">Assembly</metadata>')
      expect(new TextDecoder().decode(archive['3D/model.model']).match(/<item\b/g)).toHaveLength(1)
    }
  })
})
