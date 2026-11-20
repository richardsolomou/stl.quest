import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { InvalidMeshError } from './stl'
import { modelXml, readThreeMfArchive, isModelPart } from './threeMfArchive'
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

  it('rejects a truncated ZIP directory', () => {
    const file = zipSync({ '3D/model.model': strToU8('<model/>') })
    expect(() => parseThreeMf(file.subarray(0, file.length - 22))).toThrow('could not parse 3MF (unzip)')
  })

  it('rejects document types before parsing a model', () => {
    const archive = zipSync({ '3D/model.model': strToU8('<!DOCTYPE model><model/>') })
    expect(() => parseThreeMf(archive)).toThrow('3MF document types are unsupported')
  })

  it('allows declaration text in comments and CDATA', () => {
    const xml = '<model><!-- <!DOCTYPE --><metadata><![CDATA[<!DOCTYPE]]></metadata></model>'
    expect(modelXml(strToU8(xml))).toBe(xml)
  })

  it('limits extracted model bytes independently of other archive members', () => {
    const archive = zipSync({ '3D/model.model': new Uint8Array(1024 * 1024 + 1) })
    expect(() => readThreeMfArchive(archive, isModelPart)).toThrow('3MF exceeds the extraction budget')
  })

  it('keeps a precise message for a well-formed archive that holds no model', () => {
    const archive = zipSync({ '[Content_Types].xml': strToU8('<Types/>') })
    expect(() => parseThreeMf(archive)).toThrow(new InvalidMeshError('3MF does not contain a model'))
  })
})
