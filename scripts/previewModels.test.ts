import { describe, expect, it } from 'vitest'

import { boundingExtent, parseStl } from '../src/core/mesh/stl'
import { previewModelStl, type PreviewShape } from './previewModels'

const shapes: PreviewShape[] = ['cube', 'bracket', 'figure']

describe('previewModelStl', () => {
  it.each(shapes)('produces an STL the application can parse for %s', (shape) => {
    expect(() => parseStl(previewModelStl(shape))).not.toThrow()
  })

  it.each(shapes)('gives %s a three-dimensional extent', (shape) => {
    expect(boundingExtent(parseStl(previewModelStl(shape)))).toBeGreaterThan(1)
  })

  it('models the cube with the twelve triangles a box needs', () => {
    expect(parseStl(previewModelStl('cube')).length / 9).toBe(12)
  })

  it('models the figure as a revolved surface rather than a flat plate', () => {
    const positions = parseStl(previewModelStl('figure'))
    const depths = new Set(Array.from({ length: positions.length / 3 }, (_, vertex) => positions[vertex * 3 + 2].toFixed(2)))
    expect(depths.size).toBeGreaterThan(2)
  })
})
