import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OpenedDatabase } from './open-database'
import * as schema from './schema'
import { insertEmbedding } from './search'
import { audit, openTestDatabase, TEST_DEVICE_ID, testClock, testIds } from './testing'

/**
 * One row per table, inserted through Drizzle so the TypeScript schema and the shipped SQL
 * are proven to agree, followed by the constraints the spec asks for: foreign keys, CHECKs
 * on enums/ranges/JSON, soft deletes, partial indexes and the importance-level seed.
 */

const ALL_TABLES = [
  '_migrations',
  'achievements',
  'activities',
  'ai_calls',
  'annotations',
  'attempts',
  'blobs',
  'cards',
  'chunks',
  'chunks_fts',
  'embeddings',
  'embeddings_i8',
  'exam_attempts',
  'exam_items',
  'exams',
  'importance_levels',
  'item_bank',
  'jobs',
  'knowledge_items',
  'lesson_sessions',
  'lessons',
  'modules',
  'outbox',
  'path_versions',
  'paths',
  'review_logs',
  'scheduler_profiles',
  'sections',
  'settings',
  'source_units',
  'sources',
  'streaks',
  'xp_events',
] as const

const FSRS_DEFAULT_W = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835,
  0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
]

const SHA = 'a'.repeat(64)

describe('v1 schema', () => {
  let opened: OpenedDatabase
  const clock = testClock()
  const ids = testIds(clock)
  let now: number

  beforeEach(() => {
    opened = openTestDatabase()
    now = clock.nowMs()
  })
  afterEach(() => opened.close())

  function count(table: string): number {
    return (
      opened.sqlite.prepare<[], { n: number }>(`SELECT count(*) AS n FROM "${table}"`).get()?.n ??
      -1
    )
  }

  /** Inserts one valid row into every table, in foreign-key order, and returns the ids. */
  function seedEverything() {
    const { db, sqlite } = opened
    const a = audit(now)

    const blobId = ids.next()
    db.insert(schema.blobs)
      .values({
        id: blobId,
        sha256: SHA,
        mime: 'application/pdf',
        bytes: 1024,
        ext: 'pdf',
        originalName: 'fisio.pdf',
        meta: { pages: 12 },
        ...a,
      })
      .run()

    const sourceId = ids.next()
    db.insert(schema.sources)
      .values({
        id: sourceId,
        kind: 'pdf',
        title: 'Fisiología',
        originUri: 'file:///C:/books/fisio.pdf',
        blobSha256: SHA,
        status: 'ready',
        language: 'es',
        meta: { pages: 12 },
        ingestedAt: now,
        ...a,
      })
      .run()

    const unitId = ids.next()
    db.insert(schema.sourceUnits)
      .values({
        id: unitId,
        sourceId,
        kind: 'page',
        ordinal: 12,
        label: 'p. 12',
        text: 'El corazón…',
        blobSha256: SHA,
        meta: { width: 612 },
        ...a,
      })
      .run()

    const chunkId = ids.next()
    db.insert(schema.chunks)
      .values({
        id: chunkId,
        sourceId,
        unitId,
        ordinal: 0,
        text: 'El corazón bombea sangre.',
        charStart: 0,
        charEnd: 25,
        tokenCount: 5,
        hash: SHA,
        headingPath: 'Fisiología > Cap. 1',
        context: 'Capítulo sobre el sistema circulatorio.',
        locator: { page: 12, blockIds: ['b1'] },
        ...a,
      })
      .run()

    insertEmbedding(sqlite, {
      id: ids.next(),
      sourceId,
      chunkId,
      modelId: 'embeddinggemma-300m',
      embedding: new Float32Array(768).fill(0.1),
    })

    const annotationId = ids.next()
    db.insert(schema.annotations)
      .values({
        id: annotationId,
        sourceId,
        unitId,
        kind: 'highlight',
        anchor: { page: 12, rects: [[1, 2, 3, 4]] },
        quote: 'El corazón bombea sangre.',
        note: 'Importante',
        color: 'yellow',
        ...a,
      })
      .run()

    const pathId = ids.next()
    db.insert(schema.paths)
      .values({
        id: pathId,
        title: 'Fisiología cardiovascular',
        language: 'es-AR',
        level: 'undergraduate',
        goal: 'Aprobar el parcial',
        targetDate: '2026-11-15',
        status: 'active',
        activeVersion: 1,
        sourceIds: [sourceId],
        settings: { pace: 'normal' },
        ...a,
      })
      .run()

    const pathVersionId = ids.next()
    db.insert(schema.pathVersions)
      .values({
        id: pathVersionId,
        pathId,
        number: 1,
        spec: { id: pathId, version: 1, sections: [] },
        knowledgeGraph: { nodes: [], edges: [] },
        manifest: { models: {}, cost: { usd: 3.4 } },
        frozenAt: now,
        ...a,
      })
      .run()

    const sectionId = ids.next()
    db.insert(schema.sections)
      .values({
        id: sectionId,
        pathVersionId,
        ordinal: 0,
        specId: 'S01',
        title: 'El corazón',
        unlockRule: { kind: 'sequential' },
        xpReward: 50,
        ...a,
      })
      .run()

    const moduleId = ids.next()
    db.insert(schema.modules)
      .values({
        id: moduleId,
        sectionId,
        ordinal: 0,
        specId: 'M01',
        title: 'Anatomía',
        objectives: [{ text: 'Describir las cavidades', bloom: 'understand' }],
        diagnosticItemIds: [],
        unlockRule: null,
        xpReward: 20,
        ...a,
      })
      .run()

    const lessonId = ids.next()
    db.insert(schema.lessons)
      .values({
        id: lessonId,
        moduleId,
        ordinal: 0,
        specId: 'L01',
        kind: 'core',
        title: 'Las cuatro cavidades',
        status: 'ready',
        objectives: [{ text: 'Nombrar las cavidades', bloom: 'remember' }],
        conceptIds: ['c-heart'],
        estimatedMinutes: 8,
        theory: { blocks: [{ type: 'hook', content: 'Hola', citations: [] }] },
        citations: [
          { id: 'cit1', source_id: sourceId, block_ids: ['b1'], locator: { page: 12 }, quote: '…' },
        ],
        qa: { faithfulness: 0.96, pedagogy_score: 4, coverage_ok: true, warnings: [] },
        xpReward: 10,
        ...a,
      })
      .run()

    const remediationId = ids.next()
    db.insert(schema.lessons)
      .values({
        id: remediationId,
        moduleId,
        ordinal: 1,
        specId: 'L01.r1',
        kind: 'remediation',
        parentLessonId: lessonId,
        title: 'Repaso: cavidades',
        remediation: { trigger: 'lapses', concept_id: 'c-heart' },
        ...a,
      })
      .run()

    const activityId = ids.next()
    db.insert(schema.activities)
      .values({
        id: activityId,
        lessonId,
        ordinal: 0,
        type: 'mcq_single',
        family: 'choice',
        lang: 'es',
        bloom: 'remember',
        difficulty: 2,
        conceptIds: ['c-heart'],
        config: {
          prompt: '¿Cuántas cavidades tiene el corazón?',
          payload: { family: 'choice', sets: [] },
          review: { eligible: true, ratingStrategy: 'bin' },
        },
        grading: { method: 'det' },
        status: 'ready',
        sourceRefs: [{ docId: sourceId, span: [0, 25] }],
        ...a,
      })
      .run()

    const examId = ids.next()
    db.insert(schema.exams)
      .values({
        id: examId,
        title: 'Parcial de fisiología',
        kind: 'dated',
        date: '2026-11-15',
        pathId,
        scope: { pathIds: [pathId] },
        blueprint: [{ topic: 'corazón', weight: 0.4 }],
        targetRetention: 0.95,
        finalWindowDays: 3,
        studyDaysMask: 127,
        dailyCapacityMinutes: 45,
        status: 'active',
        ...a,
      })
      .run()

    const itemBankId = ids.next()
    db.insert(schema.itemBank)
      .values({
        id: itemBankId,
        activityId,
        pathVersionId,
        moduleId,
        usage: ['diagnostic', 'final_exam_A'],
        difficultyLogit: -0.8,
        exposure: 1,
        stats: { n: 1, p_correct: 1 },
        ...a,
      })
      .run()

    const examItemId = ids.next()
    db.insert(schema.examItems)
      .values({
        id: examItemId,
        examId,
        ordinal: 0,
        activityId,
        itemBankId,
        form: 'A',
        topic: 'corazón',
        weight: 1,
        timeLimitSec: 90,
        ...a,
      })
      .run()

    const examAttemptId = ids.next()
    db.insert(schema.examAttempts)
      .values({
        id: examAttemptId,
        examId,
        mode: 'real',
        startedAt: now,
        finishedAt: now + 60_000,
        score: 0.8,
        byTopic: { corazón: { correct: 4, total: 5 } },
        items: [{ examItemId, correct: true }],
        readinessPredicted: 0.77,
        ...a,
      })
      .run()

    const profileId = ids.next()
    db.insert(schema.schedulerProfiles)
      .values({
        id: profileId,
        scope: 'global',
        w: FSRS_DEFAULT_W,
        decay: -0.1542,
        trainedAt: null,
        ...a,
      })
      .run()

    const itemId = ids.next()
    db.insert(schema.knowledgeItems)
      .values({
        id: itemId,
        lessonId,
        topicId: 'c-heart',
        kind: 'fact',
        fields: {
          front: '¿Cuántas cavidades tiene el corazón?',
          back: 'Cuatro',
          context_cue: '[Anatomía]',
        },
        sourceId,
        annotationId,
        locator: { page: 12 },
        asOf: '2026-09-01',
        importance: 'high',
        status: 'active',
        createdBy: 'ai',
        tags: ['anatomía'],
        ...a,
      })
      .run()

    const cardId = ids.next()
    db.insert(schema.cards)
      .values({
        id: cardId,
        itemId,
        template: 'basic',
        payload: { side: 'front' },
        due: now,
        stability: 0,
        difficulty: 0,
        state: 0,
        examId,
        ...a,
      })
      .run()

    const jobId = ids.next()
    db.insert(schema.jobs)
      .values({
        id: jobId,
        kind: 'embed.chunks',
        status: 'succeeded',
        priority: 5,
        payload: { sourceId },
        result: { embedded: 1 },
        progress: { pct: 100 },
        attempts: 1,
        runAfter: now,
        startedAt: now,
        finishedAt: now + 10,
        subjectId: sourceId,
        idempotencyKey: `embed:${sourceId}`,
        ...a,
      })
      .run()

    const aiCallId = ids.next()
    db.insert(schema.aiCalls)
      .values({
        id: aiCallId,
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        role: 'smart',
        purpose: 'P10_grade',
        status: 'ok',
        inputTokens: 1200,
        outputTokens: 80,
        cachedInputTokens: 1000,
        reasoningTokens: 0,
        costUsd: 0.0012,
        latencyMs: 830,
        customId: 'grade:1',
        promptVersion: 'P10@3',
        temperature: 0,
        jobId,
        meta: { stopReason: 'end_turn' },
        ...a,
      })
      .run()

    db.insert(schema.settings)
      .values({ id: ids.next(), key: 'ai.budget.monthlyUsd', value: 30, ...a })
      .run()

    db.insert(schema.outbox)
      .values({
        id: ids.next(),
        tableName: 'cards',
        rowId: cardId,
        op: 'insert',
        rowVersion: 1,
        payload: { id: cardId },
        ...a,
      })
      .run()

    const lessonSessionId = ids.next()
    db.insert(schema.lessonSessions)
      .values({
        id: lessonSessionId,
        lessonId,
        status: 'completed',
        startedAt: now,
        finishedAt: now + 300_000,
        durationMs: 300_000,
        xp: 15,
        accuracy: 0.8,
        activitiesTotal: 5,
        activitiesCorrect: 4,
        summary: { newItems: 3 },
        ...a,
      })
      .run()

    const attemptId = ids.next()
    db.insert(schema.attempts)
      .values({
        id: attemptId,
        activityId,
        context: 'review',
        lessonSessionId,
        examAttemptId,
        cardId,
        startedAt: now,
        finishedAt: now + 4_000,
        score: 1,
        correct: 1,
        rating: 3,
        answer: { selected: 'b' },
        feedback: { text: '¡Correcto!' },
        timeMs: 4_000,
        tries: 1,
        hintsUsed: 0,
        confidence: 'sure',
        aiEvalCallId: aiCallId,
        ...a,
      })
      .run()

    db.insert(schema.reviewLogs)
      .values({
        id: ids.next(),
        cardId,
        rating: 3,
        state: 0,
        due: now,
        stability: 0,
        difficulty: 0,
        elapsedDays: 0,
        scheduledDays: 0,
        learningSteps: 0,
        review: now + 4_000,
        durationMs: 4_000,
        context: 'daily',
        exerciseScore: 1,
        device: 'win32 desktop',
        attemptId,
        ...a,
      })
      .run()

    db.insert(schema.xpEvents)
      .values({
        id: ids.next(),
        amount: 15,
        reason: 'lesson',
        subjectKind: 'lesson_session',
        subjectId: lessonSessionId,
        occurredAt: now,
        multiplier: 1,
        meta: { streakDay: 3 },
        ...a,
      })
      .run()

    db.insert(schema.streaks)
      .values({
        id: ids.next(),
        kind: 'review',
        currentLength: 3,
        longestLength: 12,
        goal: 10,
        lastActiveDay: '2026-09-02',
        startedOn: '2026-08-31',
        freezesAvailable: 1,
        holidays: ['2026-12-25'],
        ...a,
      })
      .run()

    db.insert(schema.achievements)
      .values({
        id: ids.next(),
        key: 'retaining_100',
        progress: 42,
        target: 100,
        meta: { tier: 'bronze' },
        ...a,
      })
      .run()

    return { sourceId, chunkId, itemId, cardId, lessonId, activityId, examId, jobId, attemptId }
  }

  it('accepts one valid row per table through Drizzle, JSON columns included', () => {
    seedEverything()
    for (const table of ALL_TABLES) {
      expect(count(table), table).toBeGreaterThanOrEqual(1)
    }
    expect(count('importance_levels')).toBe(5)
    expect(count('_migrations')).toBe(3)
    expect(count('lessons')).toBe(2)
  })

  it('round-trips JSON columns and enum-typed text through Drizzle', () => {
    const { lessonId, itemId } = seedEverything()
    const lesson = opened.db.query.lessons
      .findFirst({ where: eq(schema.lessons.id, lessonId) })
      .sync()
    expect(lesson?.qa).toEqual({
      faithfulness: 0.96,
      pedagogy_score: 4,
      coverage_ok: true,
      warnings: [],
    })
    expect(lesson?.objectives).toEqual([{ text: 'Nombrar las cavidades', bloom: 'remember' }])
    expect(lesson?.kind).toBe('core')

    const item = opened.db.query.knowledgeItems
      .findFirst({
        where: eq(schema.knowledgeItems.id, itemId),
      })
      .sync()
    expect(item?.fields).toMatchObject({ back: 'Cuatro' })
    expect(item?.importance).toBe('high')
    expect(item?.deviceId).toBe(TEST_DEVICE_ID)
    expect(item?.version).toBe(1)
  })

  it('enforces foreign keys', () => {
    seedEverything()
    expect(() =>
      opened.db
        .insert(schema.cards)
        .values({ id: ids.next(), itemId: ids.next(), template: 'basic', due: now, ...audit(now) })
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/)
    expect(() =>
      opened.db
        .insert(schema.sources)
        .values({
          id: ids.next(),
          kind: 'pdf',
          title: 'x',
          blobSha256: 'b'.repeat(64),
          ...audit(now),
        })
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/)
    expect(opened.sqlite.pragma('foreign_key_check')).toEqual([])
  })

  it('rejects values outside the importance and state enums', () => {
    const { itemId } = seedEverything()
    expect(() =>
      opened.db
        .insert(schema.knowledgeItems)
        .values({
          id: ids.next(),
          kind: 'fact',
          fields: {},
          importance: 'critical' as never,
          ...audit(now),
        })
        .run(),
    ).toThrow(/CHECK constraint failed: knowledge_items_importance/)
    expect(() =>
      opened.db
        .insert(schema.cards)
        .values({ id: ids.next(), itemId, template: 'reverse', due: now, state: 5, ...audit(now) })
        .run(),
    ).toThrow(/CHECK constraint failed: cards_state/)
    expect(() =>
      opened.db
        .insert(schema.cards)
        .values({
          id: ids.next(),
          itemId,
          template: 'reverse',
          due: now,
          importanceOverride: 'nope' as never,
          ...audit(now),
        })
        .run(),
    ).toThrow(/CHECK constraint failed: cards_importance_override/)
  })

  it('rejects ratings, ranges and statuses the spec does not allow', () => {
    const { cardId, itemId } = seedEverything()
    const log = {
      id: ids.next(),
      cardId,
      rating: 3,
      state: 0,
      due: now,
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      learningSteps: 0,
      review: now,
      context: 'daily' as const,
      ...audit(now),
    }
    expect(() =>
      opened.db
        .insert(schema.reviewLogs)
        .values({ ...log, rating: 5 })
        .run(),
    ).toThrow(/review_logs_rating/)
    expect(() =>
      opened.db
        .insert(schema.reviewLogs)
        .values({ ...log, id: ids.next(), context: 'bogus' as never })
        .run(),
    ).toThrow(/review_logs_context/)
    expect(() =>
      opened.db
        .insert(schema.reviewLogs)
        .values({ ...log, id: ids.next(), exerciseScore: 1.5 })
        .run(),
    ).toThrow(/review_logs_exercise_score_range/)
    expect(() =>
      opened.db
        .insert(schema.cards)
        .values({
          id: ids.next(),
          itemId,
          template: 'cloze:c1',
          due: now,
          difficulty: 11,
          ...audit(now),
        })
        .run(),
    ).toThrow(/cards_difficulty_range/)
    expect(() =>
      opened.db
        .insert(schema.jobs)
        .values({
          id: ids.next(),
          kind: 'x',
          status: 'paused' as never,
          payload: {},
          runAfter: now,
          ...audit(now),
        })
        .run(),
    ).toThrow(/jobs_status/)
    expect(() =>
      opened.db
        .insert(schema.activities)
        .values({
          id: ids.next(),
          type: 'mcq_single',
          family: 'choice',
          lang: 'es',
          difficulty: 9,
          config: {},
          grading: {},
          ...audit(now),
        })
        .run(),
    ).toThrow(/activities_difficulty_range/)
    expect(() =>
      opened.db
        .insert(schema.exams)
        .values({ id: ids.next(), title: 'x', kind: 'dated', date: '15/11/2026', ...audit(now) })
        .run(),
    ).toThrow(/exams_date_iso/)
  })

  it('rejects malformed JSON and JSON of the wrong shape', () => {
    const a = audit(now)
    const insert =
      (sql: string, ...params: unknown[]) =>
      () =>
        opened.sqlite.prepare(sql).run(...params)
    expect(
      insert(
        'INSERT INTO sources (id, kind, title, meta, created_at, updated_at, device_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ids.next(),
        'pdf',
        'x',
        '{not json',
        a.createdAt,
        a.updatedAt,
        a.deviceId,
      ),
    ).toThrow(/sources_meta_json/)
    expect(
      insert(
        'INSERT INTO sources (id, kind, title, meta, created_at, updated_at, device_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ids.next(),
        'pdf',
        'x',
        '[1, 2]',
        a.createdAt,
        a.updatedAt,
        a.deviceId,
      ),
    ).toThrow(/sources_meta_json/)
    expect(
      insert(
        'INSERT INTO scheduler_profiles (id, scope, w, created_at, updated_at, device_id) VALUES (?, ?, ?, ?, ?, ?)',
        ids.next(),
        'global',
        '{"w0": 1}',
        a.createdAt,
        a.updatedAt,
        a.deviceId,
      ),
    ).toThrow(/scheduler_profiles_w_json/)
    expect(
      insert(
        'INSERT INTO settings (id, key, value, created_at, updated_at, device_id) VALUES (?, ?, ?, ?, ?, ?)',
        ids.next(),
        'k',
        'undefined',
        a.createdAt,
        a.updatedAt,
        a.deviceId,
      ),
    ).toThrow(/settings_value_json/)
  })

  it('rejects ids that are not UUIDv7 and audit columns that contradict each other', () => {
    const a = audit(now)
    expect(() =>
      opened.db
        .insert(schema.settings)
        .values({ id: 'not-a-uuid', key: 'k', value: 1, ...a })
        .run(),
    ).toThrow(/settings_id_uuidv7/)
    expect(() =>
      opened.db
        .insert(schema.settings)
        .values({ id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', key: 'k', value: 1, ...a })
        .run(),
    ).toThrow(/settings_id_uuidv7/)
    expect(() =>
      opened.db
        .insert(schema.settings)
        .values({ id: ids.next(), key: 'k', value: 1, ...a, updatedAt: now - 1 })
        .run(),
    ).toThrow(/settings_updated_after_created/)
    expect(() =>
      opened.db
        .insert(schema.settings)
        .values({ id: ids.next(), key: 'k', value: 1, ...a, version: 0 })
        .run(),
    ).toThrow(/settings_version_positive/)
  })

  it('keeps review_logs append-only at the database level', () => {
    const { cardId } = seedEverything()
    const [log] = opened.db.select().from(schema.reviewLogs).all()
    expect(log).toBeDefined()

    expect(() =>
      opened.db
        .update(schema.reviewLogs)
        .set({ rating: 1, updatedAt: now + 1, version: 2 })
        .where(eq(schema.reviewLogs.cardId, cardId))
        .run(),
    ).toThrow(/review_logs_append_only/)

    // The one permitted change: following the parent card's soft delete.
    opened.db
      .update(schema.reviewLogs)
      .set({ deletedAt: now + 1 })
      .where(eq(schema.reviewLogs.cardId, cardId))
      .run()
    expect(opened.db.select().from(schema.reviewLogs).all()[0]?.deletedAt).toBe(now + 1)
  })

  it('soft-deletes: the row stays, deleted_at is set, live-only unique indexes free the key', () => {
    seedEverything()
    const settingId = ids.next()
    opened.db
      .insert(schema.settings)
      .values({ id: settingId, key: 'theme', value: 'dark', ...audit(now) })
      .run()

    expect(() =>
      opened.db
        .insert(schema.settings)
        .values({ id: ids.next(), key: 'theme', value: 'light', ...audit(now) })
        .run(),
    ).toThrow(/UNIQUE constraint failed/)

    opened.db
      .update(schema.settings)
      .set({ deletedAt: now + 1, updatedAt: now + 1, version: 2 })
      .where(eq(schema.settings.id, settingId))
      .run()
    expect(
      opened.db.query.settings.findFirst({ where: eq(schema.settings.id, settingId) }).sync(),
    ).toMatchObject({ deletedAt: now + 1, version: 2 })

    opened.db
      .insert(schema.settings)
      .values({ id: ids.next(), key: 'theme', value: 'light', ...audit(now) })
      .run()
    expect(count('settings')).toBe(3)
  })

  it('declares the partial cards_due index and the rl_card index from the memory spec', () => {
    const cardIndexes = opened.sqlite.pragma("index_list('cards')") as {
      name: string
      partial: number
      unique: number
    }[]
    const cardsDue = cardIndexes.find((index) => index.name === 'cards_due')
    expect(cardsDue).toMatchObject({ partial: 1, unique: 0 })
    const ddl = opened.sqlite
      .prepare<[], { sql: string }>("SELECT sql FROM sqlite_master WHERE name = 'cards_due'")
      .get()?.sql
    expect(ddl).toMatch(/WHERE "cards"\."suspended" = 0 AND "cards"\."deleted_at" IS NULL/)

    const logIndexes = opened.sqlite.pragma("index_list('review_logs')") as { name: string }[]
    expect(logIndexes.map((index) => index.name)).toContain('rl_card')
    expect(opened.sqlite.pragma("index_info('rl_card')")).toEqual([
      expect.objectContaining({ name: 'card_id' }),
      expect.objectContaining({ name: 'review' }),
    ])
  })

  it('ships the five importance levels with the spec values', () => {
    const levels = opened.db
      .select()
      .from(schema.importanceLevels)
      .orderBy(schema.importanceLevels.orderRank)
      .all()
    expect(
      levels.map((l) => ({
        name: l.name,
        dr: l.desiredRetention,
        max: l.maxIntervalDays,
        order: l.orderRank,
        postpone: l.postponeAllowed,
        newPerDay: l.newPerDay,
        leech: l.leechAction,
        threshold: l.leechThreshold,
      })),
    ).toEqual([
      {
        name: 'urgent',
        dr: 0.95,
        max: 180,
        order: 1,
        postpone: 0,
        newPerDay: null,
        leech: 'warn',
        threshold: 8,
      },
      {
        name: 'high',
        dr: 0.92,
        max: 365,
        order: 2,
        postpone: 1,
        newPerDay: 20,
        leech: 'warn_rewrite',
        threshold: 8,
      },
      {
        name: 'normal',
        dr: 0.9,
        max: 1825,
        order: 3,
        postpone: 1,
        newPerDay: 15,
        leech: 'edit',
        threshold: 8,
      },
      {
        name: 'maintenance',
        dr: 0.85,
        max: 3650,
        order: 4,
        postpone: 1,
        newPerDay: 0,
        leech: 'suspend',
        threshold: 8,
      },
      {
        name: 'paused',
        dr: null,
        max: null,
        order: 5,
        postpone: 0,
        newPerDay: 0,
        leech: 'none',
        threshold: 8,
      },
    ])
    for (const level of levels) {
      expect(level.id).toMatch(/^01a05a43-fc00-7/)
      expect(level.deviceId).toBe('system')
      expect(level.deletedAt).toBeNull()
    }
    // `name` is unique: a sixth level cannot sneak in, nor a duplicate.
    expect(() =>
      opened.db
        .insert(schema.importanceLevels)
        .values({
          id: ids.next(),
          name: 'normal',
          orderRank: 9,
          postponeAllowed: 1,
          leechAction: 'warn',
          ...audit(now),
        })
        .run(),
    ).toThrow(/UNIQUE constraint failed/)
  })

  it('gives every domain table the audit column set', () => {
    const domainTables = ALL_TABLES.filter(
      (t) => !['_migrations', 'chunks_fts', 'embeddings', 'embeddings_i8'].includes(t),
    )
    for (const table of domainTables) {
      const columns = (
        opened.sqlite.pragma(`table_info('${table}')`) as {
          name: string
          notnull: number
          pk: number
        }[]
      ).map((c) => [c.name, c.notnull, c.pk] as const)
      expect(columns[0], table).toEqual(['id', 1, 1])
      const names = columns.map(([name]) => name)
      for (const required of ['created_at', 'updated_at', 'deleted_at', 'device_id', 'version']) {
        expect(names, `${table}.${required}`).toContain(required)
      }
    }
  })
  it('lets one item carry several cards of the same template, each with its own FSRS state', () => {
    const { itemId } = seedEverything()
    for (const _ of [1, 2]) {
      opened.db
        .insert(schema.cards)
        .values({ id: ids.next(), itemId, template: 'mcq', due: now, ...audit(now) })
        .run()
    }
    expect(
      opened.db.select().from(schema.cards).where(eq(schema.cards.itemId, itemId)).all(),
    ).toHaveLength(3)
  })

  it('accepts a negative elapsed_days in review_logs (imports, clock steps) instead of losing the review', () => {
    const { cardId } = seedEverything()
    opened.db
      .insert(schema.reviewLogs)
      .values({
        id: ids.next(),
        cardId,
        rating: 3,
        state: 2,
        due: now,
        stability: 5,
        difficulty: 5,
        elapsedDays: -3,
        scheduledDays: 4,
        learningSteps: 0,
        review: now,
        context: 'import',
        ...audit(now),
      })
      .run()
    expect(count('review_logs')).toBe(2)
  })
})
