import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { InvalidMeshError } from './stl'
import { parseThreeMf } from './threeMf'

describe('parseThreeMf failures', () => {
  it('names the unzip stage and keeps the cause when the archive is not a zip', () => {
    let caught: unknown
    try {
      parseThreeMf(new Uint8Array([1, 2, 3, 4]))
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(InvalidMeshError)
    expect((caught as InvalidMeshError).message).toBe('could not parse 3MF (unzip)')
    expect((caught as InvalidMeshError).cause).toBeInstanceOf(Error)
  })

  it('keeps a precise message for a well-formed archive that holds no model', () => {
    const archive = zipSync({ '[Content_Types].xml': strToU8('<Types/>') })
    expect(() => parseThreeMf(archive)).toThrow(new InvalidMeshError('3MF does not contain a model'))
  })
})
