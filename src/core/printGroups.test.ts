import { describe, expect, it } from 'vitest'
import {
  MAX_PRINT_GROUP_NAME_LENGTH,
  parsePrintGroupPath,
  printGroupBranchIds,
  printGroupPaths,
  printGroupRows,
  validPrintGroupName,
} from './printGroups'

describe('print group names', () => {
  it('accepts a name at the maximum length', () => {
    expect(validPrintGroupName('x'.repeat(MAX_PRINT_GROUP_NAME_LENGTH))).toBe(true)
  })

  it.each(['', '   ', 'x'.repeat(MAX_PRINT_GROUP_NAME_LENGTH + 1)])('rejects invalid name %j', (name) => {
    expect(validPrintGroupName(name)).toBe(false)
  })
})

const node = (id: string, name: string, parentId?: string) => ({ id, name, parentId })

describe('printGroupRows', () => {
  it('nests children under their parent', () => {
    const rows = printGroupRows([node('child', 'Plate 14', 'root'), node('root', 'Build plates')])
    expect(rows).toEqual([
      { group: node('root', 'Build plates'), depth: 0, path: 'Build plates' },
      { group: node('child', 'Plate 14', 'root'), depth: 1, path: 'Build plates / Plate 14' },
    ])
  })

  it('orders siblings alphabetically', () => {
    expect(printGroupRows([node('b', 'Terrain'), node('a', 'Minis')]).map((row) => row.group.id)).toEqual(['a', 'b'])
  })

  it('lists a group whose parent no longer exists as a root', () => {
    expect(printGroupRows([node('orphan', 'Plate 14', 'deleted')])).toEqual([
      { group: node('orphan', 'Plate 14', 'deleted'), depth: 0, path: 'Plate 14' },
    ])
  })

  it('keeps a cycle visible instead of recursing forever', () => {
    expect(printGroupRows([node('a', 'A', 'b'), node('b', 'B', 'a')]).map((row) => row.group.id)).toEqual(['a', 'b'])
  })
})

it('maps every group to its full path', () => {
  expect(printGroupPaths([node('root', 'Build plates'), node('child', 'Plate 14', 'root')]).get('child')).toBe('Build plates / Plate 14')
})

describe('parsePrintGroupPath', () => {
  const rows = printGroupRows([node('root', 'Build plates'), node('child', 'Plate 14', 'root')])

  it('creates at the top level when no parent is typed', () => {
    expect(parsePrintGroupPath('Terrain', rows)).toMatchObject({ name: 'Terrain', parent: undefined, path: 'Terrain', creatable: true })
  })

  it('nests under an existing path regardless of case and spacing', () => {
    expect(parsePrintGroupPath('build plates/Plate 15', rows)).toMatchObject({
      name: 'Plate 15',
      path: 'Build plates / Plate 15',
      creatable: true,
    })
  })

  it('refuses a parent path that does not exist', () => {
    expect(parsePrintGroupPath('Terrain / Rocks', rows).creatable).toBe(false)
  })

  it('refuses a path that is already taken', () => {
    expect(parsePrintGroupPath('Build plates / Plate 14', rows).creatable).toBe(false)
  })

  it('allows the same leaf name under a different parent', () => {
    expect(parsePrintGroupPath('Plate 14', rows).creatable).toBe(true)
  })

  it.each(['', '   ', ' / ', 'x'.repeat(MAX_PRINT_GROUP_NAME_LENGTH + 1)])('refuses invalid name %j', (input) => {
    expect(parsePrintGroupPath(input, rows).creatable).toBe(false)
  })
})

describe('printGroupBranchIds', () => {
  it('collects the group and every descendant', () => {
    const groups = [node('root', 'Build plates'), node('child', 'Plate 14', 'root'), node('grandchild', 'Left half', 'child')]
    expect(printGroupBranchIds(groups, 'root')).toEqual(new Set(['root', 'child', 'grandchild']))
  })

  it('excludes siblings of the group', () => {
    const groups = [node('root', 'Build plates'), node('child', 'Plate 14', 'root'), node('other', 'Terrain')]
    expect(printGroupBranchIds(groups, 'child')).toEqual(new Set(['child']))
  })

  it('falls back to the group itself when it is unknown', () => {
    expect(printGroupBranchIds([], 'missing')).toEqual(new Set(['missing']))
  })
})
