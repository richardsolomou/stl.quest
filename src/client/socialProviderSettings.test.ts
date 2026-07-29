import { describe, expect, it } from 'vitest'
import { SOCIAL_AUTH_PROVIDERS } from '../core/auth'
import { SOCIAL_PROVIDER_OPTIONS, SOCIAL_PROVIDER_SETTINGS } from './socialProviderSettings'

describe('social provider settings', () => {
  it('keeps every supported provider configurable', () => {
    expect(SOCIAL_PROVIDER_OPTIONS.map(({ id }) => id)).toEqual(SOCIAL_AUTH_PROVIDERS)
  })

  it('only requests an origin where the provider requires it', () => {
    expect(SOCIAL_AUTH_PROVIDERS.filter((provider) => SOCIAL_PROVIDER_SETTINGS[provider].showOrigin)).toEqual(['google'])
  })
})
