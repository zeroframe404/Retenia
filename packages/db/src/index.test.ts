import type { Clock, IdGenerator } from '@retenia/core'
import { describe, expect, it } from 'vitest'
import { createInMemoryRepository } from './index'

const fixedClock: Clock = { now: () => new Date('2026-09-02T00:00:00.000Z') }
const sequentialIds: IdGenerator = (() => {
  let n = 0
  return { next: () => `id-${++n}` }
})()

interface Note {
  id: string
  text: string
  deletedAt?: Date
}

describe('@retenia/db createInMemoryRepository', () => {
  it('creates, finds, and soft-deletes without ever hard-deleting a row', () => {
    const repo = createInMemoryRepository<Note>(fixedClock, sequentialIds)

    const note = repo.create({ text: 'hello' })
    expect(repo.findById(note.id)).toEqual(note)

    repo.softDelete(note.id, fixedClock.now())
    const afterDelete = repo.findById(note.id)
    expect(afterDelete).toBeDefined()
    expect(afterDelete?.deletedAt).toEqual(fixedClock.now())
  })
})
