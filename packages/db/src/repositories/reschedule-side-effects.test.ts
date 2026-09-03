import { createHash } from 'node:crypto'
import {
  createFsrsScheduler,
  createImportanceCatalog,
  createImportanceResolver,
  createRescheduleNow,
  createSimulateReschedule,
} from '@retenia/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OpenedDatabase } from '../open-database'
import { openTestDatabase, type TestClock, testClock } from '../testing'
import { createRepositories } from './index'

/**
 * The acceptance criterion of sub-phase 4.2, proved against the real SQLite adapter rather
 * than a double: **`simulateReschedule` is side-effect free**, and `rescheduleNow` writes
 * only what it is allowed to.
 *
 * Side-effect freedom is already structural — `createSimulateReschedule` takes a repository
 * slice with no write method on it — so this is the belt to that braces: a byte-level
 * snapshot of every table the operation could plausibly touch, before and after.
 */

const DAY = 86_400_000
const SNAPSHOT_TABLES = [
  'cards',
  'review_logs',
  'knowledge_items',
  'importance_levels',
  'outbox',
] as const

let opened: OpenedDatabase
let clock: TestClock
let repos: ReturnType<typeof createRepositories>
let itemIds: string[]

/** A digest of every row of every table the reschedule could reach, in a stable order. */
function snapshot(): Record<string, string> {
  const digests: Record<string, string> = {}
  for (const table of SNAPSHOT_TABLES) {
    const rows = opened.sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all()
    digests[table] = createHash('sha256').update(JSON.stringify(rows)).digest('hex')
  }
  return digests
}

beforeEach(async () => {
  opened = openTestDatabase()
  clock = testClock()
  // The outbox on, so a stray write would show up there too.
  repos = createRepositories(opened, { deviceId: 'test-device', clock, outboxEnabled: true })

  itemIds = []
  const now = clock.now()
  for (const [index, importance] of (['urgent', 'normal', 'maintenance'] as const).entries()) {
    const item = await repos.knowledgeItems.create({
      lessonId: null,
      topicId: null,
      kind: 'fact',
      fields: { front: `q${index}`, back: `a${index}` },
      sourceId: null,
      annotationId: null,
      locator: null,
      asOf: null,
      importance,
      status: 'active',
      createdBy: 'user',
      tags: [],
    })
    itemIds.push(item.id)
    for (const template of ['basic', 'reverse']) {
      await repos.cards.create({
        itemId: item.id,
        template,
        payload: null,
        due: new Date(now.getTime() + 30 * DAY),
        stability: 30,
        difficulty: 5,
        scheduledDays: 30,
        learningSteps: 0,
        reps: 4,
        lapses: 0,
        state: 2,
        lastReview: now,
        suspended: false,
        buriedUntil: null,
        leech: false,
        importanceOverride: null,
        importanceOverrideExpiresAt: null,
        examId: null,
      })
    }
  }
})

afterEach(() => {
  opened.close()
})

function useCases() {
  const scheduler = createFsrsScheduler()
  const resolve = createImportanceResolver({ catalog: createImportanceCatalog() })
  return {
    simulate: createSimulateReschedule({ repos, resolve, scheduler, clock }),
    apply: createRescheduleNow({ uow: repos, resolve, scheduler, clock }),
  }
}

describe('simulateReschedule', () => {
  it('leaves the database byte-for-byte identical', async () => {
    const before = snapshot()
    const impact = await useCases().simulate()

    // It really did work — an empty projection would make the assertion vacuous.
    expect(impact.affected).toBeGreaterThan(0)
    expect(snapshot()).toEqual(before)
  })

  it('stays side-effect free when it is selecting and filtering too', async () => {
    const before = snapshot()
    const { simulate } = useCases()
    await simulate({ itemIds })
    await simulate({ levels: ['urgent'] })
    await simulate({ cardIds: [] })
    expect(snapshot()).toEqual(before)
  })
})

describe('rescheduleNow', () => {
  it('moves only `due` and `scheduled_days`, and appends one manual log per card', async () => {
    const before = opened.sqlite.prepare('SELECT * FROM cards ORDER BY id').all() as Record<
      string,
      unknown
    >[]
    const logsBefore = opened.sqlite.prepare('SELECT count(*) AS n FROM review_logs').get() as {
      n: number
    }

    const { impact, applied } = await useCases().apply({ confirm: true })
    expect(applied).toBe(impact.affected)
    expect(applied).toBeGreaterThan(0)

    const after = opened.sqlite.prepare('SELECT * FROM cards ORDER BY id').all() as Record<
      string,
      unknown
    >[]
    const moved = new Set(impact.changes.map((change) => change.cardId))

    for (const [index, row] of after.entries()) {
      const was = before[index] as Record<string, unknown>
      expect(row.id).toBe(was.id)
      // The memory state is the scheduler's alone (`.claude/skills/fsrs-rules/SKILL.md`).
      for (const column of ['stability', 'difficulty', 'reps', 'lapses', 'state', 'last_review']) {
        expect(row[column]).toBe(was[column])
      }
      if (moved.has(row.id as string)) {
        expect(row.due).not.toBe(was.due)
      } else {
        expect(row.due).toBe(was.due)
      }
    }

    const logs = opened.sqlite
      .prepare('SELECT rating, context FROM review_logs ORDER BY id')
      .all() as { rating: number; context: string }[]
    expect(logs).toHaveLength(logsBefore.n + applied)
    expect(logs.every((log) => log.rating === 0 && log.context === 'manual_postpone')).toBe(true)
  })

  it('books what the simulation projected, exactly', async () => {
    const { simulate, apply } = useCases()
    const projected = await simulate()
    const { impact } = await apply({ confirm: true })
    expect(impact.changes).toEqual(projected.changes)

    for (const change of impact.changes) {
      const card = await repos.cards.findById(change.cardId)
      expect(card?.due).toEqual(change.newDue)
      expect(card?.scheduledDays).toBe(change.newIntervalDays)
    }
  })
})
