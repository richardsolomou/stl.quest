import { describe, expect, it } from 'vitest'
import { InvalidMeshError } from './stl'
import { isObj, parseObj } from './obj'

const encode = (value: string) => new TextEncoder().encode(value)

describe('OBJ geometry', () => {
  it('triangulates faces across objects and centers the geometry', () => {
    const file = encode('o first\nv 0 0 0\nv 10 0 0\nv 10 20 0\nv 0 20 0\nf 1 2 3 4\no second\nv 0 0 5\nv 10 0 5\nv 0 20 5\nf -3 -2 -1\n')
    const positions = parseObj(file)
    expect(positions.length).toBe(27)
    expect(Math.min(...positions)).toBe(-10)
    expect(Math.max(...positions)).toBe(10)
  })

  it('rejects an OBJ with no faces', () => {
    expect(() => parseObj(encode('v 0 0 0\n'))).toThrow(InvalidMeshError)
  })

  it('rejects invalid face indices', () => {
    expect(() => parseObj(encode('v 0 0 0\nf 1 2 3\n'))).toThrow(InvalidMeshError)
  })

  it('rejects vertex coordinates outside the supported float range', () => {
    expect(() => parseObj(encode('v 1e100 0 0\nv 0 1 0\nv 0 0 1\nf 1 2 3\n'))).toThrow(InvalidMeshError)
  })

  it('recognizes OBJ vertex data after object names and comments', () => {
    expect(isObj(encode('# model\no part\nv 0 0 0\n'))).toBe(true)
  })
})
