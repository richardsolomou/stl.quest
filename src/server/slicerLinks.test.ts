import { describe, expect, it } from 'vitest'
import { SLICER_LINK_TTL_MS, signSlicerLink, verifySlicerLink } from './slicerLinks'

const secret = 'deployment-secret'
const claims = { workspaceId: 'farm', requestId: 'request-1', userId: 'maker' }
const now = 1_000_000

function link() {
  const [, , , payload, signature] = signSlicerLink(secret, claims, now).split('/')
  return { payload, signature }
}

describe('slicer links', () => {
  it('opens under /api/slicer with the signature as an extensionless last segment', () => {
    expect(signSlicerLink(secret, claims, now)).toMatch(/^\/api\/slicer\/[\w-]+\/[\w-]+$/)
  })

  it('returns the signed claims', () => {
    const { payload, signature } = link()
    expect(verifySlicerLink(secret, payload, signature, now)).toEqual({ ...claims, expiresAt: now + SLICER_LINK_TTL_MS })
  })

  it('works until it expires', () => {
    const { payload, signature } = link()
    expect(verifySlicerLink(secret, payload, signature, now + SLICER_LINK_TTL_MS)).toBeDefined()
  })

  it('stops working once it expires', () => {
    const { payload, signature } = link()
    expect(verifySlicerLink(secret, payload, signature, now + SLICER_LINK_TTL_MS + 1)).toBeUndefined()
  })

  it('rejects claims changed after signing', () => {
    const { signature } = link()
    const forged = Buffer.from(JSON.stringify({ ...claims, workspaceId: 'other', expiresAt: now + SLICER_LINK_TTL_MS })).toString(
      'base64url',
    )
    expect(verifySlicerLink(secret, forged, signature, now)).toBeUndefined()
  })

  it('rejects a signature from another secret', () => {
    const [, , , payload, signature] = signSlicerLink('other-secret', claims, now).split('/')
    expect(verifySlicerLink(secret, payload, signature, now)).toBeUndefined()
  })

  it('rejects a truncated signature', () => {
    const { payload, signature } = link()
    expect(verifySlicerLink(secret, payload, signature.slice(1), now)).toBeUndefined()
  })
})
