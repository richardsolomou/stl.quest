import { describe, expect, it } from 'vitest'
import type { Consumable } from '../core/consumables'
import type { EquipmentItem } from '../core/equipment'
import type { PublicPrintRequest } from '../core/types'
import type { StockLevel, UsageEvent } from '../core/usage'
import { workflow } from '../core/workflow'
import {
  finishingGroups,
  finishingSettled,
  materialNeeded,
  noteStepMoves,
  prefillFinishing,
  prefillMaterial,
  prefillPrinter,
  printingGroups,
  printingSettled,
  stepReached,
  stepUsageInputs,
  stockShortfalls,
  type FinishingGroup,
  type PrintingGroup,
  type StepCatalog,
} from './stepUsage'

const statuses = workflow.statuses
const mars = { id: 'mars', name: 'Mars', printType: 'resin' as const }
const saturn = { id: 'saturn', name: 'Saturn', printType: 'resin' as const }
const a1 = { id: 'a1', name: 'A1', printType: 'filament' as const }
const grey: Consumable = { id: 'grey', kind: 'resin', name: 'Grey', pricePerLitre: 30, densityGramsPerMl: 1.1 }
const clear: Consumable = { id: 'clear', kind: 'resin', name: 'Clear', pricePerLitre: 40, densityGramsPerMl: 1.1 }
const pla: Consumable = { id: 'pla', kind: 'filament', name: 'PLA', pricePerKg: 20 }
const machine = (id: string, stage: EquipmentItem['stage'], printType?: EquipmentItem['printType']): EquipmentItem => ({
  id,
  name: id,
  kind: stage === 'finishing' ? 'wash' : 'dryer',
  stage,
  ...(printType && { printType }),
  powerWatts: 50,
  minutesPerUse: 10,
  supplies: [],
})
const wash = machine('wash', 'finishing', 'resin')
const cure = machine('cure', 'finishing', 'resin')
const dryer = machine('dryer', 'before-printing', 'filament')

let clock = 0
const used = (event: Partial<UsageEvent>): UsageEvent => ({
  id: `event-${++clock}`,
  transactionId: `tx-${clock}`,
  stage: 'printing',
  kind: 'use',
  amount: 1,
  unit: 'ml',
  createdAt: clock,
  ...event,
})
const request = (id: string, fields: Partial<PublicPrintRequest> = {}) =>
  ({ id, name: id, printType: 'resin', counts: {}, ...fields }) as PublicPrintRequest
const catalog = (fields: Partial<StepCatalog> = {}): StepCatalog => ({
  printers: [mars, saturn, a1],
  consumables: [grey, clear, pla],
  equipment: [wash, cure, dryer],
  events: [],
  ...fields,
})

describe('stepReached', () => {
  it('asks for printing when copies move forward onto it', () => {
    expect(stepReached(statuses, 'up_next', 'in_progress')).toBe('printing')
  })

  it('asks for finishing when copies move forward onto it', () => {
    expect(stepReached(statuses, 'in_progress', 'post_processing')).toBe('finishing')
  })

  it('asks nothing when copies move back onto printing', () => {
    expect(stepReached(statuses, 'post_processing', 'in_progress')).toBeUndefined()
  })

  it('asks nothing for other stages', () => {
    expect(stepReached(statuses, 'todo', 'up_next')).toBeUndefined()
  })
})

describe('noteStepMoves', () => {
  it('joins copies of a print already waiting at the same step', () => {
    const pending = noteStepMoves([{ requestId: 'r', step: 'printing', copies: 1 }], statuses, [
      { id: 'r', from: 'up_next', to: 'in_progress', count: 2 },
    ])
    expect(pending).toEqual([{ requestId: 'r', step: 'printing', copies: 3 }])
  })

  it('drops a print waiting at a step its copies moved back out of', () => {
    const pending = noteStepMoves([{ requestId: 'r', step: 'printing', copies: 1 }], statuses, [
      { id: 'r', from: 'in_progress', to: 'up_next', count: 1 },
    ])
    expect(pending).toEqual([])
  })

  it('remembers the printer a print was started on', () => {
    const pending = noteStepMoves([], statuses, [{ id: 'r', from: 'up_next', to: 'in_progress', count: 1, printerId: 'mars' }])
    expect(pending).toEqual([{ requestId: 'r', step: 'printing', copies: 1, printerId: 'mars' }])
  })

  it('keeps copies started on different printers apart', () => {
    const pending = noteStepMoves([{ requestId: 'r', step: 'printing', copies: 1, printerId: 'mars' }], statuses, [
      { id: 'r', from: 'up_next', to: 'in_progress', count: 1, printerId: 'saturn' },
    ])
    expect(pending).toHaveLength(2)
  })

  it('keeps other prints waiting when one moves back', () => {
    const pending = noteStepMoves([{ requestId: 'other', step: 'printing', copies: 1 }], statuses, [
      { id: 'r', from: 'in_progress', to: 'up_next', count: 1 },
    ])
    expect(pending).toEqual([{ requestId: 'other', step: 'printing', copies: 1 }])
  })
})

describe('prefillPrinter', () => {
  it('prefers the assigned printer', () => {
    expect(prefillPrinter(request('r', { printer: saturn }), 'resin', catalog())).toBe('saturn')
  })

  it('falls back to the printer last used for the print type', () => {
    const events = [used({ printerId: 'a1' }), used({ printerId: 'mars' })]
    expect(prefillPrinter(request('r'), 'resin', catalog({ events }))).toBe('mars')
  })

  it('ignores undone usage', () => {
    const events = [used({ printerId: 'mars' }), used({ printerId: 'saturn', undoneAt: 99 })]
    expect(prefillPrinter(request('r'), 'resin', catalog({ events }))).toBe('mars')
  })

  it('ignores estimates of past prints', () => {
    const events = [used({ printerId: 'mars' }), used({ printerId: 'saturn', estimated: true })]
    expect(prefillPrinter(request('r'), 'resin', catalog({ events }))).toBe('mars')
  })

  it('takes the only printer of the type when nothing was used yet', () => {
    expect(prefillPrinter(request('r', { printType: 'filament' }), 'filament', catalog())).toBe('a1')
  })

  it('leaves a choice between printers open when nothing was used yet', () => {
    expect(prefillPrinter(request('r'), 'resin', catalog())).toBeUndefined()
  })
})

describe('prefillMaterial', () => {
  it('takes the material the printer last used', () => {
    const events = [used({ printerId: 'mars', consumableId: 'grey' }), used({ printerId: 'saturn', consumableId: 'clear' })]
    expect(prefillMaterial('resin', 'mars', catalog({ events }))).toBe('grey')
  })

  it('falls back to the material last used for the print type', () => {
    const events = [used({ printerId: 'saturn', consumableId: 'clear' })]
    expect(prefillMaterial('resin', 'mars', catalog({ events }))).toBe('clear')
  })

  it('never offers a material of another print type', () => {
    const events = [used({ printerId: 'mars', consumableId: 'pla' })]
    expect(prefillMaterial('resin', 'mars', catalog({ events }))).toBeUndefined()
  })

  it('takes the only material of the type when nothing was used yet', () => {
    expect(prefillMaterial('filament', 'a1', catalog())).toBe('pla')
  })
})

describe('prefillFinishing', () => {
  const finished = (transactionId: string, requestId: string, equipmentId: string) =>
    used({ stage: 'finishing', transactionId, requestId, equipmentId })

  it('takes the kit last used together for the print type', () => {
    const events = [finished('old', 'r1', 'cure'), finished('new', 'r2', 'wash'), finished('new', 'r2', 'cure')]
    const types = new Map([
      ['r1', 'resin' as const],
      ['r2', 'resin' as const],
    ])
    expect(prefillFinishing('resin', catalog({ events }), types).sort()).toEqual(['cure', 'wash'])
  })

  it('skips kit last used for another print type', () => {
    const shared = machine('oven', 'finishing')
    const events = [finished('resin', 'r1', 'wash'), finished('filament', 'f1', 'oven')]
    const types = new Map([
      ['r1', 'resin' as const],
      ['f1', 'filament' as const],
    ])
    expect(prefillFinishing('resin', catalog({ events, equipment: [wash, shared] }), types)).toEqual(['wash'])
  })

  it('takes the only piece of kit when nothing was used yet', () => {
    expect(prefillFinishing('resin', catalog({ equipment: [wash] }), new Map())).toEqual(['wash'])
  })

  it('leaves a choice between pieces of kit open when nothing was used yet', () => {
    expect(prefillFinishing('resin', catalog(), new Map())).toEqual([])
  })
})

describe('printingGroups', () => {
  const moves = (ids: string[]) => ids.map((requestId) => ({ requestId, step: 'printing' as const, copies: 1 }))

  it('asks once for prints prefilled with the same printer', () => {
    const groups = printingGroups(moves(['r1', 'r2']), [request('r1'), request('r2')], catalog())
    expect(groups.map((group) => group.moves.length)).toEqual([2])
  })

  it('asks per printer when prints are assigned to different printers', () => {
    const requests = [request('r1', { printer: mars }), request('r2', { printer: saturn })]
    expect(printingGroups(moves(['r1', 'r2']), requests, catalog()).map(({ printerId }) => printerId)).toEqual(['mars', 'saturn'])
  })

  it('uses the printer a print was started on over its assignment', () => {
    const [group] = printingGroups(
      [{ requestId: 'r1', step: 'printing', copies: 1, printerId: 'saturn' }],
      [request('r1', { printer: mars })],
      catalog(),
    )
    expect([group.printerId, group.printerChosen]).toEqual(['saturn', true])
  })

  it('keeps asking when a print was started without picking a printer', () => {
    expect(printingGroups(moves(['r1']), [request('r1', { printer: mars })], catalog())[0].printerChosen).toBe(false)
  })

  it('offers only printers and materials of the print type', () => {
    const [group] = printingGroups(moves(['r1']), [request('r1', { printType: 'filament' })], catalog())
    expect([group.printers, group.materials.map(({ id }) => id)]).toEqual([[a1], ['pla']])
  })

  it('offers kit used before printing for the print type', () => {
    const [group] = printingGroups(moves(['r1']), [request('r1', { printType: 'filament' })], catalog())
    expect(group.preparation).toEqual([dryer])
  })

  it('asks nothing when the workspace has nothing to record for printing', () => {
    expect(printingGroups(moves(['r1']), [request('r1')], catalog({ printers: [], consumables: [], equipment: [] }))).toEqual([])
  })

  it('asks nothing for a print with no print type', () => {
    expect(printingGroups(moves(['r1']), [request('r1', { printType: undefined })], catalog())).toEqual([])
  })
})

describe('finishingGroups', () => {
  const finishing = (requestId: string) => ({ requestId, step: 'finishing' as const, copies: 1 })

  it('asks once per print type', () => {
    const groups = finishingGroups([finishing('r1'), finishing('r2')], [request('r1'), request('r2')], catalog())
    expect(groups.map((group) => group.moves.length)).toEqual([2])
  })

  it('asks nothing for a print type with no finishing kit', () => {
    expect(finishingGroups([finishing('f1')], [request('f1', { printType: 'filament' })], catalog())).toEqual([])
  })
})

describe('materialNeeded', () => {
  it('multiplies the per-copy estimate by the copies', () => {
    const moves = [{ request: request('r', { automaticEstimatedMaterial: 12, estimatedMaterialUnit: 'ml' }), copies: 3 }]
    expect(materialNeeded(moves, grey as Extract<Consumable, { kind: 'resin' }>)).toBe(36)
  })

  it('counts nothing for a print with no estimate', () => {
    expect(materialNeeded([{ request: request('r'), copies: 3 }], grey as Extract<Consumable, { kind: 'resin' }>)).toBe(0)
  })
})

describe('stockShortfalls', () => {
  const level = (fields: Partial<StockLevel>): StockLevel => ({
    consumableId: 'grey',
    unit: 'ml',
    onHand: 100,
    tracked: true,
    low: false,
    missing: false,
    ...fields,
  })

  it('flags a material whose needs together exceed its stock', () => {
    const needs = [
      { consumableId: 'grey', amount: 60 },
      { consumableId: 'grey', amount: 60 },
    ]
    expect(stockShortfalls(needs, [level({})]).get('grey')).toEqual({ needed: 120, onHand: 100, unit: 'ml' })
  })

  it('stays quiet when there is enough', () => {
    expect(stockShortfalls([{ consumableId: 'grey', amount: 60 }], [level({})]).size).toBe(0)
  })

  it('stays quiet for untracked stock', () => {
    expect(stockShortfalls([{ consumableId: 'grey', amount: 60 }], [level({ onHand: 0, tracked: false })]).size).toBe(0)
  })
})

describe('stepUsageInputs', () => {
  const [group] = printingGroups([{ requestId: 'r', step: 'printing', copies: 2 }], [request('r', { printer: mars })], catalog())

  it('records each print with the copies that moved', () => {
    expect(stepUsageInputs([{ group, choice: { printerId: 'mars', consumableId: 'grey', equipmentIds: [] } }], [])).toEqual([
      { requestId: 'r', stage: 'printing', copies: 2, printerId: 'mars', consumableId: 'grey' },
    ])
  })

  it('records nothing for a group with nothing chosen', () => {
    expect(stepUsageInputs([{ group, choice: { equipmentIds: [] } }], [])).toEqual([])
  })
})

describe('settled steps', () => {
  const group = (printers: number, materials: number, printerChosen = false) =>
    ({
      printers: Array.from({ length: printers }),
      materials: Array.from({ length: materials }),
      printerChosen,
    }) as unknown as PrintingGroup

  it('asks nothing when printing has one printer and one material', () => {
    expect(printingSettled(group(1, 1))).toBe(true)
  })

  it('asks when there is a choice of printer', () => {
    expect(printingSettled(group(2, 1))).toBe(false)
  })

  it('asks nothing about a printer picked when starting', () => {
    expect(printingSettled(group(2, 1, true))).toBe(true)
  })

  it('asks when there is a choice of material', () => {
    expect(printingSettled(group(1, 2))).toBe(false)
  })

  it('asks nothing when finishing has a single piece of kit', () => {
    expect(finishingSettled({ equipment: [{}] } as unknown as FinishingGroup)).toBe(true)
  })
})
