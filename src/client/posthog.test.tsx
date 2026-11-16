import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PostHogIntegration } from './posthog'

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
