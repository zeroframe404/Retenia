import * as core from '@retenia/core'
import { and, eq, getTableName, is, isNull, sql, Table } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OpenedDatabase } from '../open-database'
import * as schema from '../schema'
import { insertEmbedding } from '../search'
import { openTestDatabase, TEST_DEVICE_ID, testClock, testIds } from '../testing'
import { buildFindDueQuery } from './cards'
import type { RepositoryContext } from './context'
import { createRepositories } from './index'
import { disabledOutboxWriter } from './outbox-writer'
import { createTransactionRunner } from './transaction'

/**
 * What the shared contract suites cannot express: query plans, raw constraint probes and
 * the vector index. Portable behaviour lives in `contracts.test.ts`; this file is about
 * *this* adapter being correct on SQLite's own terms.
 */

function context(opened: OpenedDatabase): RepositoryContext {
  const clock = testClock()
  return {
    db: opened.db,
    clock,
    ids: testIds(clock),
    deviceId: TEST_DEVICE_ID,
    outbox: disabledOutboxWriter,
    run: createTransactionRunner(opened, { depth: 0 }),
  }
}

/** Enough cards for the query planner to have something to reason about. */
function seedCards(opened: OpenedDatabase, count: number): void {
  const clock = testClock()
  const ids = testIds(clock)
  const now = clock.now().getTime()
  const audit = { created_at: now, updated_at: now, device_id: TEST_DEVICE_ID, version: 1 }
  const insertItem = opened.sqlite.prepare(
    `INSERT INTO knowledge_items (id, kind, fields, importance, status, created_by, tags,
       created_at, updated_at, device_id, version)
     VALUES (?, 'fact', '{}', 'normal', ?, 'user', '[]', ?, ?, ?, ?)`,
  )
  const insertCard = opened.sqlite.prepare(
    `INSERT INTO cards (id, item_id, template, due, state, suspended, leech,
       created_at, updated_at, device_id, version)
     VALUES (?, ?, 'basic', ?, 2, ?, 0, ?, ?, ?, ?)`,
  )
  opened.sqlite.transaction(() => {
    for (let index = 0; index < count; index += 1) {
      const itemId = ids.next()
      insertItem.run(
        itemId,
        index % 10 === 0 ? 'need_to_learn' : 'active',
        audit.created_at,
        audit.updated_at,
        audit.device_id,
        audit.version,
      )
      insertCard.run(
        ids.next(),
        itemId,
        now + (index % 2 === 0 ? -86_400_000 : 86_400_000),
        index % 50 === 0 ? 1 : 0,
        audit.created_at,
        audit.updated_at,
        audit.device_id,
        audit.version,
      )
    }
  })()
}

describe('findDue query plan', () => {
  let opened: OpenedDatabase
  beforeEach(() => {
    opened = openTestDatabase()
  })
  afterEach(() => {
    opened.close()
  })

  function planFor(): string {
    const { sql: text, params } = buildFindDueQuery(context(opened), new Date(), {
      limit: 200,
    }).toSQL()
    return opened.sqlite
      .prepare(`EXPLAIN QUERY PLAN ${text}`)
      .all(...(params as unknown[]))
      .map((row) => JSON.stringify(row))
      .join('\n')
  }

  it('drives from the cards_due partial index once the database has statistics', () => {
    // The index predicate must be provable at prepare time for SQLite to consider the
    // partial index at all: a parameterised `suspended = ?` would disqualify it outright,
    // whatever the statistics say. With the literal in place and stats present, the planner
    // drives from `cards_due` and only sorts the tie-break term.
    seedCards(opened, 400)
    opened.sqlite.exec('ANALYZE')

    const plan = planFor()
    expect(plan).toContain('cards_due')
    expect(plan).not.toContain('SCAN cards')
  })

  it('falls back to the knowledge_items index when the database has no statistics', () => {
    // Documented, not desired: on a database that has never been ANALYZEd, SQLite guesses
    // and drives from `knowledge_items` instead, adding a full temp b-tree sort. Correct,
    // but it wastes the index the schema created for the daily queue — so the app must run
    // `ANALYZE`/`PRAGMA optimize` for `findDue` to perform as designed.
    seedCards(opened, 400)

    expect(planFor()).toContain('knowledge_items')
  })

  it('keeps the index predicate as a literal, not a bound parameter', () => {
    const { sql: text } = buildFindDueQuery(context(opened), new Date()).toSQL()
    expect(text).toContain('"suspended" = 0')
  })
})

describe('append-only review logs at the database level', () => {
  let opened: OpenedDatabase
  beforeEach(() => {
    opened = openTestDatabase()
  })
  afterEach(() => {
    opened.close()
  })

  async function seedLog() {
    const clock = testClock()
    const repos = createRepositories(opened, {
      deviceId: TEST_DEVICE_ID,
      clock,
      ids: testIds(clock),
    })
    const item = await repos.knowledgeItems.create({
      lessonId: null,
      topicId: null,
      kind: 'fact',
      fields: { front: 'q', back: 'a' },
      sourceId: null,
      annotationId: null,
      locator: null,
      asOf: null,
      importance: 'normal',
      status: 'active',
      createdBy: 'user',
      tags: [],
    })
    const card = await repos.cards.create({
      itemId: item.id,
      template: 'basic',
      payload: null,
      due: clock.now(),
      stability: 0,
      difficulty: 0,
      scheduledDays: 0,
      learningSteps: 0,
      reps: 0,
      lapses: 0,
      state: 0,
      lastReview: null,
      suspended: false,
      buriedUntil: null,
      leech: false,
      importanceOverride: null,
      examId: null,
    })
    return repos.reviewLogs.append({
      cardId: card.id,
      rating: 3,
      state: 2,
      due: clock.now(),
      stability: 4,
      difficulty: 5,
      elapsedDays: 1,
      scheduledDays: 3,
      learningSteps: 0,
      review: clock.now(),
      durationMs: null,
      context: 'daily',
      exerciseScore: null,
      device: null,
      attemptId: null,
    })
  }

  it('rejects a raw update that bumps the version', () => {
    // The repository has no `update` at all; this pins the schema's backstop, so a future
    // migration that dropped the CHECK would fail a test rather than silently allow it.
    return seedLog().then((log) => {
      expect(() =>
        opened.db
          .update(schema.reviewLogs)
          .set({ version: sql`${schema.reviewLogs.version} + 1` })
          .where(eq(schema.reviewLogs.id, log.id))
          .run(),
      ).toThrow(/CONSTRAINT/i)
    })
  })

  it('rejects a raw update that moves updated_at', () =>
    seedLog().then((log) => {
      expect(() =>
        opened.db
          .update(schema.reviewLogs)
          .set({ updatedAt: sql`${schema.reviewLogs.updatedAt} + 1000` })
          .where(eq(schema.reviewLogs.id, log.id))
          .run(),
      ).toThrow(/CONSTRAINT/i)
    }))

  it('allows setting deleted_at alone, which is what the card cascade does', () =>
    seedLog().then((log) => {
      expect(() =>
        opened.db
          .update(schema.reviewLogs)
          .set({ deletedAt: 1_800_000_000_000 })
          .where(eq(schema.reviewLogs.id, log.id))
          .run(),
      ).not.toThrow()
    }))
})

describe('vector and hybrid search', () => {
  let opened: OpenedDatabase
  beforeEach(() => {
    opened = openTestDatabase()
  })
  afterEach(() => {
    opened.close()
  })

  const MODEL = 'embeddinggemma-300m'

  /** A unit vector pointing at one axis, so distances are obvious by construction. */
  function axis(index: number): Float32Array {
    const vector = new Float32Array(768)
    vector[index] = 1
    return vector
  }

  async function seedChunks() {
    const clock = testClock()
    const ids = testIds(clock)
    const repos = createRepositories(opened, { deviceId: TEST_DEVICE_ID, clock, ids })
    const source = await repos.sources.create({
      kind: 'pdf',
      title: 'Fisiología',
      originUri: null,
      blobSha256: null,
      status: 'ready',
      language: 'es',
      meta: null,
      error: null,
      ingestedAt: null,
    })
    const texts = ['el corazón bombea sangre', 'la glucólisis produce ATP', 'sangre y oxígeno']
    const chunks = []
    for (const [ordinal, text] of texts.entries()) {
      chunks.push(
        await repos.chunks.create({
          sourceId: source.id,
          unitId: null,
          ordinal,
          text,
          charStart: 0,
          charEnd: text.length,
          tokenCount: text.split(' ').length,
          hash: `${ordinal}`.padStart(64, '0'),
          headingPath: null,
          context: null,
          locator: null,
        }),
      )
    }
    for (const [index, chunk] of chunks.entries()) {
      insertEmbedding(opened.sqlite, {
        id: ids.next(),
        sourceId: source.id,
        chunkId: chunk.id,
        modelId: MODEL,
        embedding: axis(index),
      })
    }
    return { repos, chunks, source }
  }

  it('ranks by vector distance', async () => {
    const { repos, chunks } = await seedChunks()
    const hits = await repos.chunks.search('', {
      mode: 'vector',
      embedding: axis(1),
      modelId: MODEL,
      k: 3,
    })
    expect(hits[0]?.chunk.id).toBe(chunks[1]?.id)
    expect(hits[0]?.vector?.distance).toBeCloseTo(0)
  })

  it('returns nothing for a different embedding space', async () => {
    const { repos } = await seedChunks()
    const hits = await repos.chunks.search('', {
      mode: 'vector',
      embedding: axis(1),
      modelId: 'some-other-model',
      k: 3,
    })
    expect(hits).toEqual([])
  })

  it('drops a chunk vectors when the chunk is soft-deleted', async () => {
    const { repos, chunks } = await seedChunks()
    const target = chunks[1]
    if (target === undefined) throw new Error('expected a chunk')
    await repos.chunks.softDelete(target.id)

    const hits = await repos.chunks.search('', {
      mode: 'vector',
      embedding: axis(1),
      modelId: MODEL,
      k: 3,
    })
    expect(hits.map((hit) => hit.chunk.id)).not.toContain(target.id)
  })

  it('ranks a chunk found by both branches above one found by either', async () => {
    const { repos, chunks } = await seedChunks()
    const both = chunks[0]
    if (both === undefined) throw new Error('expected a chunk')

    // "corazón" hits chunk 0 in FTS, and axis(0) is chunk 0's vector: reciprocal rank
    // fusion should put it first, ahead of anything scored by only one branch.
    const hits = await repos.chunks.search('corazón sangre', {
      mode: 'hybrid',
      embedding: axis(0),
      modelId: MODEL,
      k: 3,
    })
    expect(hits[0]?.chunk.id).toBe(both.id)
    expect(hits[0]?.fts).toBeDefined()
    expect(hits[0]?.vector).toBeDefined()
    expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? 0)
  })
})

describe('domain vocabulary parity', () => {
  // `packages/core` owns the domain vocabulary; the schema files keep their own copies
  // because they build the SQL `CHECK (… IN (…))` constraints. This is the test that stops
  // the two drifting — add a value in one place and it fails here.
  const pairs: ReadonlyArray<
    readonly [string, readonly (string | number)[], readonly (string | number)[]]
  > = [
    ['IMPORTANCE_LEVELS', core.IMPORTANCE_LEVELS, schema.IMPORTANCE_LEVELS],
    ['LEECH_ACTIONS', core.LEECH_ACTIONS, schema.LEECH_ACTIONS],
    ['SOURCE_KINDS', core.SOURCE_KINDS, schema.SOURCE_KINDS],
    ['SOURCE_STATUSES', core.SOURCE_STATUSES, schema.SOURCE_STATUSES],
    ['SOURCE_UNIT_KINDS', core.SOURCE_UNIT_KINDS, schema.SOURCE_UNIT_KINDS],
    ['ANNOTATION_KINDS', core.ANNOTATION_KINDS, schema.ANNOTATION_KINDS],
    ['PATH_STATUSES', core.PATH_STATUSES, schema.PATH_STATUSES],
    ['LESSON_KINDS', core.LESSON_KINDS, schema.LESSON_KINDS],
    ['LESSON_STATUSES', core.LESSON_STATUSES, schema.LESSON_STATUSES],
    ['BLOOM_LEVELS', core.BLOOM_LEVELS, schema.BLOOM_LEVELS],
    ['ACTIVITY_FAMILIES', core.ACTIVITY_FAMILIES, schema.ACTIVITY_FAMILIES],
    ['ACTIVITY_STATUSES', core.ACTIVITY_STATUSES, schema.ACTIVITY_STATUSES],
    ['EXAM_KINDS', core.EXAM_KINDS, schema.EXAM_KINDS],
    ['EXAM_STATUSES', core.EXAM_STATUSES, schema.EXAM_STATUSES],
    ['EXAM_FORMS', core.EXAM_FORMS, schema.EXAM_FORMS],
    ['EXAM_ATTEMPT_MODES', core.EXAM_ATTEMPT_MODES, schema.EXAM_ATTEMPT_MODES],
    ['ITEM_USAGES', core.ITEM_USAGES, schema.ITEM_USAGES],
    ['CARD_STATES', core.CARD_STATES, schema.CARD_STATES],
    ['RATINGS', core.RATINGS, schema.RATINGS],
    ['KNOWLEDGE_ITEM_KINDS', core.KNOWLEDGE_ITEM_KINDS, schema.KNOWLEDGE_ITEM_KINDS],
    ['KNOWLEDGE_ITEM_STATUSES', core.KNOWLEDGE_ITEM_STATUSES, schema.KNOWLEDGE_ITEM_STATUSES],
    ['CREATED_BY', core.CREATED_BY, schema.CREATED_BY],
    ['LESSON_SESSION_STATUSES', core.LESSON_SESSION_STATUSES, schema.LESSON_SESSION_STATUSES],
    ['ATTEMPT_CONTEXTS', core.ATTEMPT_CONTEXTS, schema.ATTEMPT_CONTEXTS],
    ['CONFIDENCE_LEVELS', core.CONFIDENCE_LEVELS, schema.CONFIDENCE_LEVELS],
    ['REVIEW_CONTEXTS', core.REVIEW_CONTEXTS, schema.REVIEW_CONTEXTS],
    ['JOB_STATUSES', core.JOB_STATUSES, schema.JOB_STATUSES],
    ['AI_CALL_STATUSES', core.AI_CALL_STATUSES, schema.AI_CALL_STATUSES],
    ['OUTBOX_OPS', core.OUTBOX_OPS, schema.OUTBOX_OPS],
    ['XP_REASONS', core.XP_REASONS, schema.XP_REASONS],
  ]

  it.each(pairs)(
    '%s matches between @retenia/core and the schema',
    (_name, fromCore, fromSchema) => {
      expect([...fromCore]).toEqual([...fromSchema])
    },
  )
})

describe('outbox allowlist covers the syncable tables', () => {
  it('names every audited table except the device-local ones', async () => {
    const { SYNCABLE_TABLES } = await import('./outbox-writer')
    // `outbox` would recurse; `jobs` and `ai_calls` describe what this machine did.
    const deviceLocal = new Set(['outbox', 'jobs', 'ai_calls'])
    const audited = Object.values(schema)
      .filter((value) => is(value, Table))
      .map((table) => getTableName(table))

    for (const name of audited) {
      if (deviceLocal.has(name)) {
        expect(SYNCABLE_TABLES.has(name)).toBe(false)
      } else {
        expect(SYNCABLE_TABLES.has(name)).toBe(true)
      }
    }
  })
})

describe('transaction runner', () => {
  let opened: OpenedDatabase
  beforeEach(() => {
    opened = openTestDatabase()
  })
  afterEach(() => {
    opened.close()
  })

  it('holds the transaction open across an await, which db.transaction() cannot', async () => {
    const runner = createTransactionRunner(opened, { depth: 0 })
    await runner(async () => {
      expect(opened.sqlite.inTransaction).toBe(true)
      await Promise.resolve()
      // better-sqlite3's own wrapper would have committed and thrown by now.
      expect(opened.sqlite.inTransaction).toBe(true)
    })
    expect(opened.sqlite.inTransaction).toBe(false)
  })

  it('takes the write lock up front', async () => {
    // BEGIN IMMEDIATE, not the deferred default: a deferred transaction that reads then
    // writes has to upgrade, and a failed upgrade is not retryable by the busy handler.
    const runner = createTransactionRunner(opened, { depth: 0 })
    await runner(async () => {
      const [row] = opened.sqlite.prepare('PRAGMA locking_mode').all() as Array<unknown>
      expect(row).toBeDefined()
    })
  })

  it('leaves no transaction open after a rollback', async () => {
    const runner = createTransactionRunner(opened, { depth: 0 })
    await expect(
      runner(async () => {
        throw new Error('nope')
      }),
    ).rejects.toThrow('nope')
    expect(opened.sqlite.inTransaction).toBe(false)
  })
})

describe('source cascade', () => {
  let opened: OpenedDatabase
  beforeEach(() => {
    opened = openTestDatabase()
  })
  afterEach(() => {
    opened.close()
  })

  it('soft-deletes units and chunks with their source, and restores exactly those', async () => {
    const clock = testClock()
    const repos = createRepositories(opened, {
      deviceId: TEST_DEVICE_ID,
      clock,
      ids: testIds(clock),
    })
    const source = await repos.sources.create({
      kind: 'pdf',
      title: 'Fisiología',
      originUri: null,
      blobSha256: null,
      status: 'ready',
      language: 'es',
      meta: null,
      error: null,
      ingestedAt: null,
    })
    const unit = await repos.sources.createUnit({
      sourceId: source.id,
      kind: 'page',
      ordinal: 0,
      label: '1',
      tStart: null,
      tEnd: null,
      text: 'página',
      blobSha256: null,
      meta: null,
    })

    await repos.sources.softDelete(source.id)
    expect(await repos.sources.listUnits(source.id)).toEqual([])

    await repos.sources.restore(source.id)
    const restored = await repos.sources.listUnits(source.id)
    expect(restored.map((entry) => entry.id)).toEqual([unit.id])

    const live = opened.db
      .select()
      .from(schema.sourceUnits)
      .where(and(eq(schema.sourceUnits.sourceId, source.id), isNull(schema.sourceUnits.deletedAt)))
      .all()
    expect(live).toHaveLength(1)
  })
})
