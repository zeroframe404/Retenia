import { describe, expect, it } from 'vitest'
import * as db from './index'

describe('@retenia/db public surface', () => {
  it('exposes the repository factory and the transaction helper', () => {
    expect(typeof db.createRepositories).toBe('function')
    expect(typeof db.withTransaction).toBe('function')
  })

  it('does not mirror the device-local tables into the sync outbox', () => {
    // `jobs` and `ai_calls` describe what this machine did; `outbox` would recurse.
    expect(db.SYNCABLE_TABLES.has('cards')).toBe(true)
    expect(db.SYNCABLE_TABLES.has('jobs')).toBe(false)
    expect(db.SYNCABLE_TABLES.has('ai_calls')).toBe(false)
    expect(db.SYNCABLE_TABLES.has('outbox')).toBe(false)
  })
})
