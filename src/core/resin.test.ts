import { describe, expect, it } from 'vitest'
import { formatResinMl, resinVolumeMl, summarizeResinMl } from './resin'

describe('resin volume metrics', () => {
  const sla = { id: 'sla', name: 'SLA printer', technology: 'sla' as const }
  const fdm = { id: 'fdm', name: 'FDM printer', technology: 'fdm' as const }

  it('calculates resin for the copies represented by a card', () => {
    expect(resinVolumeMl({ estimatedResinMl: 4.25, printer: sla }, 3)).toBe(12.75)
  })

  it('does not present zero volume from an open mesh as zero resin', () => {
    expect(resinVolumeMl({ estimatedResinMl: 0, printer: sla })).toBeUndefined()
  })

  it('does not show model volume as resin for FDM printers', () => {
    expect(resinVolumeMl({ estimatedResinMl: 4.25, printer: fdm })).toBeUndefined()
  })

  it('keeps unknown copies separate from the known backlog volume', () => {
    expect(
      summarizeResinMl([
        { request: { estimatedResinMl: 4.25, printer: sla }, count: 3 },
        { request: { printer: sla }, count: 2 },
        { request: { estimatedResinMl: 20, printer: fdm }, count: 4 },
      ]),
    ).toEqual({ knownMl: 12.75, unknownCopies: 2, slaCopies: 5 })
  })

  it('shows useful precision for small and large estimates', () => {
    expect([formatResinMl(0.04), formatResinMl(4.25), formatResinMl(123.6)]).toEqual(['<0.1', '4.3', '124'])
  })
})
