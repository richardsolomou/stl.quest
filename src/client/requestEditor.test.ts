import { describe, expect, it } from 'vitest'
import type { PublicPrintRequest } from '../core/types'
import { requestChangedFields, requestEditorDirty, requestEditorValues, requestUpdateData } from './requestEditor'

const request = {
  id: 'request-id',
  name: 'Model',
  quantity: 2,
  notes: 'note',
  sourceUrl: 'https://example.com/model',
  printType: 'resin',
  printer: { id: 'printer-id', name: 'Printer', printType: 'resin' },
  canEdit: true,
} as PublicPrintRequest

describe('request editor', () => {
  it('derives editable values from a request', () => {
    expect(requestEditorValues(request)).toEqual({
      name: 'Model',
      quantity: '2',
      notes: 'note',
      sourceUrl: 'https://example.com/model',
      printType: 'resin',
      printerId: 'printer-id',
      estimatedMaterial: '',
      estimatedMinutes: '',
    })
  })

  it('detects changed values only for editable requests', () => {
    const values = { ...requestEditorValues(request), quantity: '3' }

    expect(requestEditorDirty(request, values)).toBe(true)
    expect(requestEditorDirty({ ...request, canEdit: false }, values)).toBe(false)
  })

  it('reports only changed field names for telemetry', () => {
    const values = { ...requestEditorValues(request), quantity: '3', notes: 'new note', printerId: '' }

    expect(requestChangedFields(request, values)).toEqual(['quantity', 'notes', 'printer'])
  })

  it('builds an administrator update for an explicitly selected printer', () => {
    const values = { ...requestEditorValues(request), name: ' Model 2 ', quantity: '2.6', notes: ' note 2 ' }

    expect(requestUpdateData('workspace', request, values, true)).toEqual({
      workspaceSlug: 'workspace',
      id: 'request-id',
      name: 'Model 2',
      quantity: 3,
      notes: 'note 2',
      sourceUrl: 'https://example.com/model',
      requestedPrintType: undefined,
      printerId: 'printer-id',
    })
  })

  it('sends requester print type changes without printer controls', () => {
    const values = { ...requestEditorValues(request), printType: 'filament' as const, printerId: '' }

    expect(requestUpdateData('workspace', request, values, false)).toMatchObject({
      requestedPrintType: 'filament',
      printerId: undefined,
    })
  })

  it('rejects an update without a print type', () => {
    const values = { ...requestEditorValues(request), printType: '' as const }

    expect(requestUpdateData('workspace', request, values, false)).toBeUndefined()
  })
})
