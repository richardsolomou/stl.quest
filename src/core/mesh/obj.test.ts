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

  it('reads CRLF line endings, comments, blank lines, and texture or normal references', () => {
    const file = encode(
      '# exported\r\n\r\nv 0 0 0\r\nv 2 0 0\r\nv 0 2 0\r\nvt 0 0\r\nvn 0 0 1\r\n  # indented comment\r\nf 1/1/1 2/1/1 3/1/1\r\n',
    )
    expect(Array.from(parseObj(file))).toEqual([-1, -1, 0, 1, -1, 0, -1, 1, 0])
  })

  it('ignores texture and normal references to coordinates the file never defines', () => {
    expect(parseObj(encode('v 0 0 0\nv 2 0 0\nv 0 2 0\nf 1/4/9 2//9 3/7\n')).length).toBe(9)
  })

  it('fans n-gons into triangles', () => {
    expect(parseObj(encode('v 0 0 0\nv 1 0 0\nv 2 1 0\nv 1 2 0\nv 0 1 0\nf 1 2 3 4 5\n')).length).toBe(27)
  })

  it('resolves relative indices against the vertices defined so far', () => {
    const file = encode('v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1\nv 0 0 4\nf -4 -3 -1\n')
    expect(Math.max(...parseObj(file).filter((_, index) => index % 3 === 2))).toBe(2)
  })

  it('joins backslash-continued lines', () => {
    expect(parseObj(encode('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 \\\n2 3\n')).length).toBe(9)
  })

  it('joins a CRLF-continued line that ends exactly on a read chunk boundary', () => {
    const vertices = 'v 0 0 0\r\nv 1 0 0\r\nv 0 1 0\r\n'
    const continued = 'f 1 2 \\\r\n'
    const comment = `#${'x'.repeat((1 << 20) - vertices.length - continued.length - 3)}\r\n`
    expect(parseObj(encode(`${vertices}${comment}${continued}3\r\n`)).length).toBe(9)
  })

  it('reads groups and tab-separated values', () => {
    expect(parseObj(encode('g a\nv\t0\t0\t0\nv 1 0 0\nv 0 1 0\nf\t1\t2\t3\ng b\nf 3 2 1\n')).length).toBe(18)
  })

  it('rejects an OBJ that only holds points and lines', () => {
    expect(() => parseObj(encode('v 0 0 0\nv 1 0 0\nv 0 1 0\np 1\nl 1 2 3\n'))).toThrow(InvalidMeshError)
  })

  it('rejects faces that reference a vertex defined later in the file', () => {
    expect(() => parseObj(encode('v 0 0 0\nv 1 0 0\nf 1 2 3\nv 0 1 0\n'))).toThrow(InvalidMeshError)
  })

  it('rejects a zero face index', () => {
    expect(() => parseObj(encode('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 0 1 2\n'))).toThrow(InvalidMeshError)
  })

  it('keeps the faces that precede a truncated final line', () => {
    expect(parseObj(encode('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\nv 0.5 0.')).length).toBe(9)
  })

  it('rejects a face that references a truncated vertex', () => {
    expect(() => parseObj(encode('v 0 0 0\nv 1 0 0\nv 0 1\nf 1 2 3\n'))).toThrow(InvalidMeshError)
  })

  it('rejects a line too long to be OBJ data', () => {
    const file = new Uint8Array(3 << 20).fill(0x41)
    file.set(encode('v 0 0 0\nv'))
    expect(() => parseObj(file)).toThrow(InvalidMeshError)
  })

  it('rejects polygons that expand into more triangle data than the memory budget allows', () => {
    const polygon = `f ${Array.from({ length: 200 }, (_, corner) => (corner % 4) + 1).join(' ')}\n`
    const file = encode(`v 0 0 0\nv 1 0 0\nv 0 1 0\nv 1 1 1\n${polygon.repeat(10_000)}`)
    expect(() => parseObj(file)).toThrow(InvalidMeshError)
  })

  it('recognizes OBJ vertex data after object names and comments', () => {
    expect(isObj(encode('# model\no part\nv 0 0 0\n'))).toBe(true)
  })

  it('recognizes indented OBJ vertex data', () => {
    expect(isObj(encode('  v 0 0 0\n\tv 1 0 0\n'))).toBe(true)
  })

  it('recognizes OBJ vertex data after a comment header longer than the detection window', () => {
    expect(isObj(encode(`${'# licensed under terms that run on\r\n'.repeat(4000)}\nv 0 0 0\n`))).toBe(true)
  })

  it('does not mistake indented ASCII STL vertices for OBJ', () => {
    expect(isObj(encode('solid part\n  facet normal 0 0 1\n    outer loop\n      vertex 0 0 0\n'))).toBe(false)
  })
})
