import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { postHogEnvironment, serviceName } from '../contracts/posthog'
import { PostHogIntegration, postHogOptions } from './posthog'

const environment = postHogEnvironment({ projectToken: 'phc_test', host: 'https://eu.i.posthog.com' })!
const options = postHogOptions(environment, 'app.example', 'production')

describe('postHogOptions', () => {
  it('sends through the same-origin ingest proxy', () => {
    expect(options.api_host).toBe('/t')
  })

  it('links the toolbar to the project region', () => {
    expect(options.ui_host).toBe('https://eu.posthog.com')
  })

  it('pins the SDK defaults snapshot', () => {
    expect(options.defaults).toBe('2026-05-30')
  })

  it('creates person profiles only for identified users', () => {
    expect(options.person_profiles).toBe('identified_only')
  })

  it('captures unhandled errors but not console errors', () => {
    expect(options.capture_exceptions).toEqual({
      capture_console_errors: false,
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
    })
  })

  it('masks token query parameters in captured URLs', () => {
    expect([options.mask_personal_data_properties, options.custom_personal_data_properties]).toEqual([true, ['token']])
  })

  it('masks every input in session replay', () => {
    expect(options.session_recording).toEqual({ maskAllInputs: true, blockSelector: '.ph-no-capture' })
  })

  it('records no page text or element attributes', () => {
    expect([options.mask_all_text, options.mask_all_element_attributes]).toEqual([true, true])
  })

  it('adds tracing headers only to requests to this application', () => {
    expect(options.tracing_headers).toEqual(['app.example'])
  })

  it('names the browser service for logs and metrics', () => {
    expect([options.logs, options.metrics]).toEqual([
      { serviceName: `${serviceName}-web`, serviceVersion: __APP_VERSION__, environment: 'production' },
      { serviceName: `${serviceName}-web`, serviceVersion: __APP_VERSION__, environment: 'production' },
    ])
  })

  it('leaves console capture off', () => {
    expect(options.logs).not.toHaveProperty('captureConsoleLogs')
  })
})

describe('PostHogIntegration', () => {
  it('renders its children when PostHog is off', () => {
    expect(
      renderToStaticMarkup(
        <PostHogIntegration enabled fallback="failed">
          application
        </PostHogIntegration>,
      ),
    ).toBe('application')
  })
})
