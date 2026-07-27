import { beforeEach, describe, expect, it, vi } from 'vitest'

const postgres = vi.hoisted(() => vi.fn(() => vi.fn()))
const drizzle = vi.hoisted(() => vi.fn(() => ({})))

vi.mock('postgres', () => ({ default: postgres }))
vi.mock('drizzle-orm/postgres-js', () => ({ drizzle }))

describe('PostgreSQL connection', () => {
  beforeEach(() => {
    postgres.mockClear()
    drizzle.mockClear()
  })

  it('suppresses informational server notices', async () => {
    const { openPostgreSQL } = await import('./postgresConnection')

    openPostgreSQL('postgres://localhost/stlquest')

    expect(postgres).toHaveBeenCalledWith('postgres://localhost/stlquest', expect.objectContaining({ onnotice: expect.any(Function) }))
  })
})
