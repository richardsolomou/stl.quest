import { describe, expect, it } from 'vitest'
import { MODEL_FORMATS } from '@/core/assetKeys'
import { workflow } from '@/core/workflow'
import { llmsText } from './llms'

describe('llmsText', () => {
  it('names every workflow stage in order', () => {
    expect(llmsText()).toContain(`Queue, Up next, Printing, Finishing, and Ready`)
  })

  it('names the stages the application defines', () => {
    expect(workflow.statuses.map((status) => status.label).every((label) => llmsText().includes(label))).toBe(true)
  })

  it('names every model format the application accepts', () => {
    expect(MODEL_FORMATS.every((format) => llmsText().includes(format.toUpperCase()))).toBe(true)
  })

  it('states the free hosted allowance', () => {
    expect(llmsText()).toContain('include 1.0 GB of storage on the Free plan')
  })

  it('sends visitors to the hosted service at its own address', () => {
    expect(llmsText()).toContain('(https://stl.quest/sign-in?signup=true)')
  })

  it('does not claim self-hosted installs are unlimited', () => {
    expect(llmsText()).not.toMatch(/no limits/i)
  })
})
