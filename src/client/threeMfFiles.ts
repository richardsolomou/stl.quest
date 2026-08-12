import { strToU8, unzipSync, zipSync } from 'fflate'
import { XMLParser } from 'fast-xml-parser'

const THREE_MF_MIME = 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml'
type XmlNode = Record<string, unknown>

const array = <T>(value: T | T[] | undefined): T[] => (value === undefined ? [] : Array.isArray(value) ? value : [value])

export type ThreeMfInspection = { file: File; itemCount: number }

export async function inspectThreeMf(file: File): Promise<ThreeMfInspection | undefined> {
  if (!file.name.toLowerCase().endsWith('.3mf')) return undefined
  const { items } = readThreeMf(new Uint8Array(await file.arrayBuffer()))
  return items.length > 1 ? { file, itemCount: items.length } : undefined
}

export async function splitThreeMf(file: File): Promise<File[]> {
  const { archive, modelName, modelXml, items, objectNames } = readThreeMf(new Uint8Array(await file.arrayBuffer()))
  if (items.length <= 1) return [file]
  const baseName = file.name.replace(/\.3mf$/i, '')
  const usedNames = new Set<string>()
  return items.map((item, index) => {
    const objectId = attribute(item, 'objectid')
    const suggested = objectNames.get(objectId) || `Part ${index + 1}`
    const partName = uniqueName(safeName(`${baseName} - ${suggested}`), usedNames)
    const standalone = { ...archive, [modelName]: strToU8(replaceBuildItems(modelXml, item)) }
    return new File([zipSync(standalone)], `${partName}.3mf`, { type: THREE_MF_MIME, lastModified: file.lastModified })
  })
}

function readThreeMf(file: Uint8Array) {
  try {
    const archive = unzipSync(file)
    const modelName = Object.keys(archive).find((name) => /^3D\/.*\.model$/i.test(name))
    if (!modelName) throw new Error('3MF does not contain a model')
    const modelXml = new TextDecoder().decode(archive[modelName])
    const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', parseAttributeValue: false }).parse(modelXml) as {
      model?: XmlNode
    }
    const model = parsed.model
    const build = model?.build as XmlNode | undefined
    const items = array(build?.item as XmlNode | XmlNode[] | undefined)
    if (!items.length) throw new Error('3MF does not contain any build items')
    const resources = model?.resources as XmlNode | undefined
    const objects = array(resources?.object as XmlNode | XmlNode[] | undefined)
    const objectNames = new Map(objects.map((object) => [attribute(object, 'id'), typeof object.name === 'string' ? object.name : '']))
    const itemXml = buildItemXml(modelXml)
    if (itemXml.length !== items.length) throw new Error('3MF build items could not be read')
    return { archive, modelName, modelXml, items: itemXml, objectNames }
  } catch (error) {
    throw new Error(error instanceof Error ? `Invalid 3MF: ${error.message}` : 'Invalid 3MF', { cause: error })
  }
}

function buildItemXml(xml: string) {
  const build = xml.match(/<(?:\w+:)?build\b[^>]*>([\s\S]*?)<\/(?:\w+:)?build\s*>/i)?.[1]
  if (build === undefined) return []
  return [...build.matchAll(/<(?:\w+:)?item\b[^>]*\/?\s*>/gi)].map((match) => match[0])
}

function replaceBuildItems(xml: string, item: string) {
  return xml.replace(
    /(<(?:\w+:)?build\b[^>]*>)[\s\S]*?(<\/(?:\w+:)?build\s*>)/i,
    (_match, opening: string, closing: string) => `${opening}${item}${closing}`,
  )
}

function attribute(xml: string | XmlNode, name: string) {
  if (typeof xml !== 'string') {
    const value = xml[name]
    return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  }
  return xml.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1] ?? ''
}

function safeName(name: string) {
  return (
    name
      .replace(/[\\/:*?"<>|]+/g, '_')
      .trim()
      .slice(0, 180) || 'Model'
  )
}

function uniqueName(name: string, used: Set<string>) {
  let candidate = name
  let suffix = 2
  while (used.has(candidate.toLowerCase())) candidate = `${name} ${suffix++}`
  used.add(candidate.toLowerCase())
  return candidate
}
