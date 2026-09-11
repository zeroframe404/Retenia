import type { ActivityFamily, ActivityOption, AuthoredActivity, Clock } from '@retenia/core'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { BudgetGuard } from '../budget'
import { parseGenerationConfig } from '../config/generation-config'
import type { ActivityAuthor } from '../expand/activity-author'
import { expandLessons, type LessonProgress } from '../expand/expand-lessons'
import { readExpansion } from '../expand/expansion'
import { silentLogger } from '../logger'
import type { MakeFlashcardsOutput } from '../schemas/flashcards'
import type { WriteLessonOutput } from '../schemas/lesson'
import type { FaithfulnessOutput, PedagogyJudgeOutput } from '../schemas/qa'
import { createAiHarness, HARNESS_NOW } from '../testing/ai-harness'
import { createExpandRepos } from '../testing/expand-repos'
import { expandWorld } from '../testing/expand-world'
import { testPrompts } from '../testing/extract-fixtures'
import { readLessonQa } from './lesson-qa'
import { createQaPipeline } from './pipeline'

/**
 * Stage 8 inside stage 7: `expandLessons` with a `QaPipeline` wired. What `pipeline.test.ts`
 * cannot see — the `qa` → `ready` status flow, the single regeneration through P3 at the next
 * revision, the ledger's counter, and that a resume replays the gates for free.
 */

const clock: Clock = { now: () => HARNESS_NOW }

/** Enough claim-free prose to put the theory inside §4's 600–1,200-word band. */
const FILLER = Array.from(
  { length: 60 },
  () => 'Esta lección explica el concepto con calma y con ejemplos.',
).join(' ')

function theory(citeId: string): WriteLessonOutput {
  return {
    blocks: [
      {
        type: 'hook',
        content: `¿Por qué se olvida? ${FILLER}`,
        citations: [],
        diagram: null,
        misconception_id: null,
      },
      {
        type: 'explanation',
        content: `La memoria de trabajo retiene unos cuatro elementos a la vez. [cite:${citeId}]`,
        citations: [citeId],
        diagram: null,
        misconception_id: null,
      },
      {
        type: 'summary',
        content: '- Un punto\n- Otro punto',
        citations: [citeId],
        diagram: null,
        misconception_id: null,
      },
    ],
    glossary: [],
    word_count: 800,
    warnings: [],
  }
}

function cards(front: string): MakeFlashcardsOutput {
  return {
    flashcards: [
      {
        type: 'basic',
        front,
        back: 'Unos cuatro',
        cloze_text: null,
        context_cue: '[Memoria]',
        concept_ids: ['c1'],
        importance: 'high',
        interference_group: null,
        as_of: null,
        citations: ['B01'],
      },
    ],
    skipped: [],
  }
}

const FAKE_P4_SCHEMA = z.object({ ok: z.boolean() })

function fakeAuthor(): ActivityAuthor {
  const shapes: readonly [string, ActivityFamily, Partial<ActivityOption>][] = [
    ['mcq_single', 'choice', { difficulty: 1, bloom: 'remember' }],
    ['cloze_typed', 'cloze', { difficulty: 2, progression: 'production', bloom: 'understand' }],
    ['short_answer', 'text_input', { difficulty: 3, progression: 'production', bloom: 'analyze' }],
    ['free_recall', 'long_text', { difficulty: 5, progression: 'production', bloom: 'apply' }],
  ]
  return {
    plan: (request) =>
      request.families.map((family) => ({
        customId: `p4-${request.parentCustomId}-${family}-${request.variant}`,
        family,
        types: ['mcq_single'],
        misconceptionsAvailable: request.misconceptions.length > 0,
        structured: {
          prompt: `${family} for ${request.lessonSpecId}`,
          temperature: 0.7,
          schema: FAKE_P4_SCHEMA,
          schemaName: 'make_activities',
          idempotencyKey: `p4-${request.parentCustomId}-${family}-${request.variant}`,
        } as never,
        batch: {
          customId: `p4-${request.parentCustomId}-${family}-${request.variant}`,
          request: { prompt: `${family} for ${request.lessonSpecId}`, temperature: 0.7 },
        },
        injectionSuspected: false,
      })),
    collect: (call) => ({
      activities: shapes.map(([type, family, overrides], index): AuthoredActivity => {
        const key = `${call.customId}#${index}`
        return {
          key,
          option: {
            activityId: key,
            type,
            family,
            progression: 'recognition',
            ratingStrategy: 'binary',
            expectedSeconds: 30,
            eligible: true,
            hasMedia: false,
            needsMic: false,
            needsSandbox: false,
            difficulty: 3,
            bloom: 'understand',
            conceptIds: ['c1'],
            lastServedAt: null,
            ...overrides,
          },
          row: {
            type,
            family,
            schemaVersion: 1,
            lang: 'es-AR',
            bloom: overrides.bloom ?? 'understand',
            difficulty: overrides.difficulty ?? 3,
            conceptIds: ['c1'],
            misconceptionIds: [],
            config: { prompt: `${type} ${key}` },
            grading: { method: 'det' },
            status: 'ready',
            sourceRefs: [],
          },
        }
      }),
      rejected: [],
      notes: [],
    }),
  }
}

const config = parseGenerationConfig({
  goal: 'Entender la memoria de trabajo',
  level: 'beginner',
  lessonLanguage: 'es-AR',
  sourceIds: ['src-book'],
  primarySourceId: 'src-book',
})

function resolver(options: { unsupported?: boolean; judgeScore?: number } = {}) {
  return (request: { prompt: string; schemaName?: string }): string | undefined => {
    if (request.schemaName === 'write_lesson') return JSON.stringify(theory('B01'))
    if (request.schemaName === 'make_flashcards') return JSON.stringify(cards('¿Cuántos?'))
    if (request.schemaName === 'make_activities') return JSON.stringify({ ok: true })
    if (request.schemaName === 'faithfulness') {
      const ids = (/claim_ids: (.*)/.exec(request.prompt)?.[1] ?? '').split(', ').filter(Boolean)
      const output: FaithfulnessOutput = {
        claims: ids.map((id) => ({
          id,
          verdict: options.unsupported === true ? 'unsupported' : 'supported',
          citation_id: 'B01',
          sources_differ: false,
          differing_citation_ids: [],
          note: '',
        })),
      }
      return JSON.stringify(output)
    }
    if (request.schemaName === 'pedagogy_judge') {
      const score = options.judgeScore ?? 4
      const output: PedagogyJudgeOutput = {
        criteria: (
          ['clarity', 'examples_correct', 'cognitive_load', 'alignment', 'misconceptions'] as const
        ).map((id) => ({ id, score, rationale: 'r' })),
        overall: score,
        edits: [],
      }
      return JSON.stringify(output)
    }
    return undefined
  }
}

function setUp(options: { unsupported?: boolean; judgeScore?: number; lessons?: number } = {}) {
  const world = expandWorld(clock, { lessons: options.lessons ?? 2 })
  for (const chunk of world.rows.chunks) {
    chunk.text = 'La memoria de trabajo retiene unos cuatro elementos a la vez, según Cowan.'
  }
  const harness = createAiHarness({ resolve: resolver(options), clock, batch: false })
  const repos = createExpandRepos(clock, world.rows)
  const events: LessonProgress[] = []
  const qa = createQaPipeline({
    ai: harness.ai,
    registry: harness.registry,
    resultCache: harness.resultCache,
    prompts: testPrompts,
    repos,
    clock,
    timers: harness.timers,
    logger: silentLogger,
  })
  const expand = (
    input: {
      regenerate?: boolean
      moreExamples?: boolean
      onlyLessonIds?: string[]
      budget?: BudgetGuard
      perCallEstimateUsd?: number
    } = {},
  ) =>
    expandLessons(
      {
        ai: harness.ai,
        registry: harness.registry,
        resultCache: harness.resultCache,
        author: fakeAuthor(),
        qa,
        repos,
        prompts: testPrompts,
        clock,
        timers: harness.timers,
        logger: silentLogger,
        onLesson: (event) => events.push(event),
      },
      {
        runId: 'run-1',
        pathId: world.pathId,
        pathVersionId: world.pathVersionId,
        config,
        draft: world.draft,
        concepts: world.concepts,
        userWaiting: true,
        allowOverBudget: false,
        ...input,
      },
    )
  return { world, harness, repos, events, expand }
}

describe('expandLessons() with the QA gates wired', () => {
  it('moves every lesson through qa to ready, with a verdict on the row', async () => {
    const { world, repos, events, expand } = setUp()
    const result = await expand()

    expect(result.status).toBe('completed')
    expect(result.expanded).toBe(2)
    expect(result.qa).toEqual({ reviewed: 2, fixed: 0, regenerated: 0, flagged: 0 })
    for (const row of repos.rows.lessons) {
      expect(row.status).toBe('ready')
      const qa = readLessonQa(row.qa)
      expect(qa?.verdict).toBe('pass')
      expect(qa?.faithfulness).toBe(1)
      expect(qa?.pedagogy_score).toBe(4)
    }
    const first = world.rows.lessons[0] as (typeof world.rows.lessons)[number]
    const statuses = events
      .filter((event) => event.lessonId === first.id)
      .map((event) => event.status)
    expect(statuses).toEqual(['generating', 'qa', 'ready'])
    expect(events.find((event) => event.status === 'ready')?.qa).toMatchObject({
      verdict: 'pass',
      reviewed: true,
      faithfulness: 1,
    })
  })

  it('regenerates a lesson under the threshold exactly once, then flags it', async () => {
    const { world, harness, repos, expand } = setUp({ unsupported: true, lessons: 1 })
    const result = await expand()

    // P3 twice — the original and the one regeneration — never a third.
    expect(harness.replay.calls.filter((call) => call.schemaName === 'write_lesson')).toHaveLength(
      2,
    )
    expect(result.qa.flagged).toBe(1)
    expect(result.warnings.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(['lesson_regenerated', 'lesson_below_threshold']),
    )
    const row = repos.rows.lessons[0] as (typeof repos.rows.lessons)[number]
    expect(row.status).toBe('ready')
    expect(readExpansion(row.expansion, 'run-1')).toMatchObject({
      revision: 1,
      qa_regenerations: 1,
    })
    const qa = readLessonQa(row.qa)
    expect(qa?.verdict).toBe('flagged')
    expect(qa?.iterations.regenerate).toBe(1)
    // The cards were written once: a regeneration never rewrites what the learner may hold.
    expect(repos.rows.knowledgeItems.filter((item) => item.lessonId === row.id)).toHaveLength(1)
    expect(
      harness.replay.calls.filter((call) => call.schemaName === 'make_flashcards'),
    ).toHaveLength(1)
    void world
  })

  it('never regenerates on "Más ejemplos", which did not touch the theory', async () => {
    const { world, harness, expand } = setUp({ unsupported: true, lessons: 1 })
    await expand()
    const before = harness.replay.calls.filter((call) => call.schemaName === 'write_lesson').length
    const first = world.rows.lessons[0] as (typeof world.rows.lessons)[number]
    await expand({ onlyLessonIds: [first.specId], moreExamples: true })
    expect(harness.replay.calls.filter((call) => call.schemaName === 'write_lesson')).toHaveLength(
      before,
    )
  })

  it('replays a second run — gates included — with no new call', async () => {
    const { harness, expand } = setUp()
    await expand()
    const calls = harness.replay.calls.length
    const again = await expand()
    expect(harness.replay.calls.length).toBe(calls)
    expect(again.reused).toBe(2)
  })

  it('persists no verdict when the budget blocks inside the gates, and finishes on the resume', async () => {
    const { harness, repos, events, expand } = setUp()
    // Stage 7 goes through; the first check after a lesson enters `qa` hits the cap.
    const budget: BudgetGuard = {
      capUsd: 1,
      spentUsd: () => 0,
      add: () => {},
      wouldExceed: () => events.some((event) => event.status === 'qa'),
    }
    const blocked = await expand({ budget, perCallEstimateUsd: 0.01 })
    expect(blocked.status).toBe('blocked_budget')
    expect(harness.replay.calls.filter((call) => call.schemaName === 'faithfulness')).toHaveLength(
      0,
    )
    for (const row of repos.rows.lessons) {
      // Content on the row, verdict not: the lesson is still under review, not `ready`.
      expect(row.status).toBe('qa')
      expect(row.theory).not.toBeNull()
      expect(readLessonQa(row.qa)).toBeNull()
    }

    const resumed = await expand()
    expect(resumed.status).toBe('completed')
    expect(resumed.qa.reviewed).toBe(2)
    for (const row of repos.rows.lessons) {
      expect(row.status).toBe('ready')
      expect(readLessonQa(row.qa)?.verdict).toBe('pass')
    }
  })
})
