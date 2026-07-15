import { describe, expect, it } from 'vitest'
import { userImage } from './avatar'

describe('user images', () => {
  it('preserves provider images', () => {
    expect(userImage('user@example.com', 'https://cdn.example.com/avatar.png')).toBe('https://cdn.example.com/avatar.png')
  })

  it('uses normalized email for Gravatar fallback', () => {
    expect(userImage(' MyEmailAddress@example.com ')).toBe(
      'https://www.gravatar.com/avatar/84059b07d4be67b806386c0aad8070a23f18836bbaae342275dc0a83414c32ee?d=identicon&s=160',
    )
  })
})
