import { describe, expect, it } from 'vitest'
import { APP_LOGOS } from './appLogos'
import { SLICER_IDS } from './slicers'

describe('app logos', () => {
  it.each(SLICER_IDS)('serves the %s logo under its own ID', (id) => {
    expect(APP_LOGOS[id]).toMatch(new RegExp(`^/app-logos/${id}\\.(svg|png)$`))
  })

  it.each(['spoolman', 'bambuddy'] as const)('serves the %s logo under its own ID', (id) => {
    expect(APP_LOGOS[id]).toMatch(new RegExp(`^/app-logos/${id}\\.(svg|png)$`))
  })
})
