import { approximateTokens, DEFAULT_PROFILES, DEFAULT_ROLES } from '@retenia/ai'
import type { Activity, Clock } from '@retenia/core'
import { describe, expect, it } from 'vitest'
import type { BudgetGuard } from '../budget'
import { estimateGeneration } from '../estimate/estimate-generation'
import { silentLogger } from '../logger'
import { systemFor } from '../prompts'
import type { LessonCitation, LessonTheory, TheoryBlock } from '../schemas/lesson'
import type { EditLessonOutput, FaithfulnessOutput, PedagogyJudgeOutput } from '../schemas/qa'
import { createAiHarness, HARNESS_NOW } from '../testing/ai-harness'
import { createExpandRepos } from '../testing/expand-repos'
import { expandWorld } from '../testing/expand-world'
import { testPrompts } from '../testing/extract-fixtures'
import { createQaPipeline, type QaLessonInput, type QaRunInput } from './pipeline'

/**
 * Stage 8 end to end over the replay fakes: a real `AiClient` with scripted P6/P7/P8
 * answers, the in-memory repositories, and lessons with planted defects. What this suite is
 * about is the *orchestration* — which waves run, in which mode, what the verdict is, what
 * it costs — the gates themselves are covered one by one in `gates/*.test.ts`.
 */

const clock: Clock = { now: () => HARNESS_NOW }

const CHUNK_TEXT = 'Fragmento L01: la memoria de trabajo retiene unos cuatro elementos.'

/** Enough claim-free prose to put the theory inside §4's 600–1,200-word band. */
const FILLER = Array.from(
  { length: 60 },
  () => 'Esta lección explica el concepto con calma y con ejemplos.',
).join(' ')

function block(type: TheoryBlock['type'], content: string, citations: string[] = []): TheoryBlock {
  return { type, content, citations, diagram: null, misconception_id: null }
}

function theory(): LessonTheory {
  return {
    version: 1,
    blocks: [
      block('hook', `Al terminar vas a poder explicar la memoria de trabajo. ${FILLER}`),
      block(
        'explanation',
        'La memoria de trabajo retiene unos cuatro elementos a la vez. [cite:B01] Los elementos se agrupan en unidades mayores. [cite:B01]',
        ['B01'],
      ),
      block('summary', '- Cuatro elementos\n- Se agrupan', ['B01']),
    ],
    glossary: [],
    word_count: 700,
  }
}

function citation(chunkId: string): LessonCitation {
  return {
    id: 'B01',
    source_id: 'src-book',
    chunk_id: chunkId,
    block_ids: [`${chunkId}-b1`],
    locator: 'p. 1',
    quote: null,
  }
}

interface Script {
  /** Claim ids P6 marks unsupported. */
  unsupported?: readonly string[]
  judgeScore?: number
  judgeEdits?: PedagogyJudgeOutput['edits']
  edit?: (prompt: string) => EditLessonOutput
  /** Return no P6 answer at all, so the wave fails for the lesson. */
  failFaithfulness?: boolean
}

function resolver(script: Script) {
  return (request: { prompt: string; schemaName?: string }): string | undefined => {
    if (request.schemaName === 'faithfulness') {
      if (script.failFaithfulness === true) return undefined
      const ids = (/claim_ids: (.*)/.exec(request.prompt)?.[1] ?? '').split(', ').filter(Boolean)
      const output: FaithfulnessOutput = {
        claims: ids.map((id) => ({
          id,
          verdict: script.unsupported?.includes(id) === true ? 'unsupported' : 'supported',
          citation_id: 'B01',
          sources_differ: false,
          differing_citation_ids: [],
          note: '',
        })),
      }
      return JSON.stringify(output)
    }
    if (request.schemaName === 'pedagogy_judge') {
      const score = script.judgeScore ?? 4
      const output: PedagogyJudgeOutput = {
        criteria: (
          ['clarity', 'examples_correct', 'cognitive_load', 'alignment', 'misconceptions'] as const
        ).map((id) => ({ id, score, rationale: 'r' })),
        overall: score,
        edits: script.judgeEdits ?? [],
      }
      return JSON.stringify(output)
    }
    if (request.schemaName === 'edit_lesson') {
      return JSON.stringify(script.edit?.(request.prompt) ?? { changes: [], notes: [] })
    }
    return undefined
  }
}

function lessonInput(
  world: ReturnType<typeof expandWorld>,
  index: number,
  overrides: Partial<QaLessonInput> = {},
): QaLessonInput {
  const row = world.rows.lessons[index] as (typeof world.rows.lessons)[number]
  return {
    lessonId: row.id,
    specId: row.specId,
    moduleId: row.moduleId,
    title: row.title,
    objectives: [{ text: 'Explicar la capacidad limitada', bloom: 'understand' }],
    concepts: [...world.concepts.values()],
    misconceptions: [],
    theory: theory(),
    citations: [citation(`chunk-${row.specId}`)],
    p3CustomId: `p3-${row.specId}`,
    generatorModel: 'claude-sonnet-5',
    attempt: 0,
    ...overrides,
  }
}

function activityRow(
  lessonId: string,
  ordinal: number,
  prompt: string,
  type = 'short_answer',
  bloom: Activity['bloom'] = ordinal % 2 === 0 ? 'apply' : 'understand',
): Activity {
  return {
    id: `act-${lessonId}-${ordinal}`,
    lessonId,
    ordinal,
    type,
    family: 'text_input',
    schemaVersion: 1,
    lang: 'es-AR',
    bloom,
    difficulty: 2,
    conceptIds: ['c1'],
    misconceptionIds: [],
    config: { prompt },
    grading: { method: 'det' },
    status: 'ready',
    sourceRefs: [],
    createdAt: HARNESS_NOW,
    updatedAt: HARNESS_NOW,
    deletedAt: null,
    deviceId: 'test',
    version: 1,
  } as Activity
}

/**
 * A block that clears gate 6 on its own — 4 activities, 3 types, 25 % MCQ, one apply item —
 * and, across the two lessons `setUp` seeds by default, the three Bloom levels gate 6's
 * module rule wants.
 */
function seedValidActivities(repos: ReturnType<typeof createExpandRepos>, lessonId: string) {
  repos.rows.activities.push(
    activityRow(lessonId, 0, `¿Cuántos elementos hay? ${lessonId}`, 'mcq_single', 'remember'),
    activityRow(lessonId, 1, `Completá la frase. ${lessonId}`, 'cloze_typed', 'understand'),
    activityRow(lessonId, 2, `Explicá el concepto. ${lessonId}`, 'short_answer', 'analyze'),
    activityRow(lessonId, 3, `Aplicá el concepto a un caso. ${lessonId}`, 'short_answer', 'apply'),
  )
}

function setUp(
  script: Script,
  options: { lessons?: number; registry?: 'no-judge'; seedActivities?: boolean } = {},
) {
  const world = expandWorld(clock, { lessons: options.lessons ?? 2 })
  // Every lesson's chunk carries the sentence the theory quotes, so gate 2 has a source.
  for (const chunk of world.rows.chunks) chunk.text = CHUNK_TEXT
  const harness = createAiHarness({
    resolve: resolver(script),
    clock,
    batch: false,
    ...(options.registry === 'no-judge'
      ? {
          registry: {
            profiles: DEFAULT_PROFILES,
            roles: { smart: DEFAULT_ROLES.smart as never, cheap: DEFAULT_ROLES.cheap as never },
          },
        }
      : {}),
  })
  const repos = createExpandRepos(clock, world.rows)
  // Gate 6 (variety) needs a real practice block; most of this suite is testing the other
  // gates and gives every lesson one that already clears it. The duplicate tests push their
  // own activities instead, and opt out.
  if (options.seedActivities !== false) {
    for (const lesson of world.rows.lessons) seedValidActivities(repos, lesson.id)
  }
  const pipeline = createQaPipeline({
    ai: harness.ai,
    registry: harness.registry,
    resultCache: harness.resultCache,
    prompts: testPrompts,
    repos,
    clock,
    timers: harness.timers,
    logger: silentLogger,
  })
  const run = (input: Partial<QaRunInput> & { lessons: QaLessonInput[] }) =>
    pipeline.run({
      runId: 'run-1',
      pathVersionId: world.pathVersionId,
      lessonLanguage: 'es-AR',
      mode: 'full',
      userWaiting: true,
      allowOverBudget: false,
      allowRegenerate: true,
      ...input,
    })
  return { world, harness, repos, pipeline, run }
}

describe('the QA pipeline (stage 8)', () => {
  it('passes a clean lesson through P6 and P7, and bills the two calls to it', async () => {
    const { world, harness, run } = setUp({})
    const result = await run({ lessons: [lessonInput(world, 0)] })

    expect(result.status).toBe('completed')
    const [outcome] = result.outcomes
    expect(outcome?.regenerate).toBe(false)
    expect(outcome?.qa).toMatchObject({
      faithfulness: 1,
      pedagogy_score: 4,
      coverage_ok: true,
      verdict: 'pass',
      reviewed: true,
      mode: 'full',
      sources_count: 1,
      iterations: { edit: 0, regenerate: 0 },
      models: { p6: 'gemini-3.7-flash', p7: 'gemini-3.7-flash', p8: null },
    })
    expect(outcome?.qa.gates.find((gate) => gate.gate === 'judge')?.outcome).toBe('pass')
    expect(outcome?.qa.cost.calls).toBe(2)
    expect(outcome?.qa.cost.usd).toBeGreaterThan(0)
    expect(harness.replay.calls.map((call) => call.schemaName)).toEqual([
      'faithfulness',
      'pedagogy_judge',
    ])
  })

  it('costs, per lesson, no more than the wizard quoted for the stage', async () => {
    const { world, harness, run } = setUp({})
    const result = await run({ lessons: [lessonInput(world, 0), lessonInput(world, 1)] })
    const [cheap, smart, judge] = await Promise.all([
      harness.ai.ratesFor('cheap'),
      harness.ai.ratesFor('smart'),
      harness.ai.ratesFor('judge'),
    ])
    const system = (template: string) => approximateTokens(systemFor(template))
    const estimate = estimateGeneration({
      chunks: Array.from({ length: 10 }, () => ({
        text: 'x'.repeat(1600),
        context: null,
        tokenCount: 400,
      })),
      alreadyExtracted: 0,
      rates: {
        ...(cheap === undefined ? {} : { cheap }),
        ...(smart === undefined ? {} : { smart }),
        ...(judge === undefined ? {} : { judge }),
      },
      systemTokens: {
        extract: 1000,
        outline: 1000,
        module: 1000,
        lesson: 1000,
        activities: 1000,
        flashcards: 1000,
        faithfulness: system(testPrompts.faithfulness.template),
        judge: system(testPrompts.judge.template),
        edit: system(testPrompts.edit.template),
      },
      dispatch: 'sync',
    })
    const quotedPerLesson =
      (estimate.p6Faithfulness.usd +
        estimate.p7Judge.usd +
        estimate.p8Edit.usd +
        estimate.qaRegenerate.usd) /
      estimate.lessons
    for (const outcome of result.outcomes) {
      expect(outcome.qa.cost.usd).toBeGreaterThan(0)
      expect(outcome.qa.cost.usd).toBeLessThanOrEqual(quotedPerLesson)
    }
  })

  it('runs gates (a)–(h) only in light mode: one call, no judge, no editor', async () => {
    const { world, harness, run } = setUp({ judgeEdits: [] })
    const result = await run({ mode: 'light', lessons: [lessonInput(world, 0)] })
    expect(harness.replay.calls.map((call) => call.schemaName)).toEqual(['faithfulness'])
    expect(result.outcomes[0]?.qa).toMatchObject({
      mode: 'light',
      pedagogy_score: null,
      verdict: 'pass',
      models: { p7: null, p8: null },
    })
    expect(result.outcomes[0]?.qa.gates.find((gate) => gate.gate === 'judge')?.outcome).toBe(
      'skipped',
    )
  })

  it('sends a lesson under 0.7 back to P3 once, and flags it the second time', async () => {
    const { world, run } = setUp({ unsupported: ['c01'] })
    const first = await run({ lessons: [lessonInput(world, 0)] })
    expect(first.outcomes[0]?.qa.faithfulness).toBe(0.5)
    expect(first.outcomes[0]?.regenerate).toBe(true)

    const second = await run({
      lessons: [lessonInput(world, 0, { attempt: 1, p3CustomId: 'p3-L01-rev1' })],
    })
    expect(second.outcomes[0]?.regenerate).toBe(false)
    expect(second.outcomes[0]?.qa).toMatchObject({
      verdict: 'flagged',
      reviewed: true,
      iterations: { regenerate: 1 },
    })
    expect(second.warnings.map((entry) => entry.code)).toContain('lesson_below_threshold')

    // "Más ejemplos" never rewrites the theory: flagged straight away.
    const noRewrite = await run({ allowRegenerate: false, lessons: [lessonInput(world, 0)] })
    expect(noRewrite.outcomes[0]?.regenerate).toBe(false)
    expect(noRewrite.outcomes[0]?.qa.verdict).toBe('flagged')
  })

  it('asks for a regeneration when the judge scores under 3', async () => {
    const { world, run } = setUp({ judgeScore: 2 })
    const result = await run({ lessons: [lessonInput(world, 0)] })
    expect(result.outcomes[0]?.qa.pedagogy_score).toBe(2)
    expect(result.outcomes[0]?.regenerate).toBe(true)
  })

  it('never lets the lesson’s own author judge it', async () => {
    // The `judge` role resolves to Gemini; a lesson Gemini wrote (the smart role's fallback
    // answered) is skipped rather than judged, and the run says why.
    const { world, harness, run } = setUp({})
    const result = await run({
      lessons: [lessonInput(world, 0, { generatorModel: 'gemini-3.7-flash' })],
    })
    expect(harness.replay.calls.map((call) => call.schemaName)).toEqual(['faithfulness'])
    expect(result.outcomes[0]?.qa.pedagogy_score).toBeNull()
    expect(result.warnings.map((entry) => entry.code)).toContain('judge_same_as_generator')
  })

  it('skips the judge, and says so, when no judge role is configured', async () => {
    const { world, run } = setUp({}, { registry: 'no-judge' })
    const result = await run({ lessons: [lessonInput(world, 0)] })
    expect(result.outcomes[0]?.qa.verdict).toBe('pass')
    expect(result.warnings.map((entry) => entry.code)).toContain('judge_unavailable')
  })

  it('applies the judge’s edits through P8 once, then verifies the edited claims again', async () => {
    const { world, harness, run } = setUp({
      judgeEdits: [
        {
          block_index: 1,
          kind: 'replace',
          instruction: 'Define the term first.',
          replacement: null,
        },
      ],
      edit: () => ({
        changes: [
          {
            block_index: 1,
            kind: 'replace',
            content:
              'Definamos primero el término. La memoria de trabajo retiene unos cuatro elementos a la vez. [cite:B01] Los elementos se agrupan en unidades mayores. [cite:B01]',
          },
        ],
        notes: [],
      }),
    })
    const result = await run({ lessons: [lessonInput(world, 0)] })
    expect(harness.replay.calls.map((call) => call.schemaName)).toEqual([
      'faithfulness',
      'pedagogy_judge',
      'edit_lesson',
      'faithfulness',
    ])
    const [outcome] = result.outcomes
    expect(outcome?.qa.verdict).toBe('fixed')
    expect(outcome?.qa.iterations.edit).toBe(1)
    expect(outcome?.theory.blocks[1]?.content).toContain('Definamos primero')
    expect(outcome?.theory.blocks[1]?.citations).toEqual(['B01'])
    expect(outcome?.qa.cost.calls).toBe(4)
  })

  it('keeps the original block when P8 touches a citation, and still calls it only once', async () => {
    const { world, harness, run } = setUp({
      judgeEdits: [{ block_index: 1, kind: 'replace', instruction: 'x', replacement: null }],
      edit: () => ({
        changes: [{ block_index: 1, kind: 'replace', content: 'Sin ninguna cita ahora.' }],
        notes: [],
      }),
    })
    const result = await run({ lessons: [lessonInput(world, 0)] })
    expect(harness.replay.calls.map((call) => call.schemaName)).toEqual([
      'faithfulness',
      'pedagogy_judge',
      'edit_lesson',
    ])
    const [outcome] = result.outcomes
    expect(outcome?.theory.blocks[1]?.content).toBe(theory().blocks[1]?.content)
    expect(outcome?.qa.verdict).toBe('pass')
    expect(outcome?.qa.findings.map((finding) => finding.kind)).toContain('edit_rejected')
  })

  it('flags, and leaves unreviewed, a lesson whose verifier call failed', async () => {
    const { world, run } = setUp({ failFaithfulness: true })
    const result = await run({ lessons: [lessonInput(world, 0)] })
    expect(result.outcomes[0]?.qa).toMatchObject({ verdict: 'flagged', reviewed: false })
    expect(result.warnings.map((entry) => entry.code)).toContain('qa_failed')
  })

  it('leaves a lesson unreviewed, never passed, when the budget blocks before the verifier', async () => {
    const { world, harness, run } = setUp({})
    const budget: BudgetGuard = {
      capUsd: 1,
      spentUsd: () => 0,
      add: () => {},
      wouldExceed: () => true,
    }
    const result = await run({
      lessons: [lessonInput(world, 0)],
      budget,
      perCallEstimateUsd: 0.01,
    })
    expect(result.status).toBe('blocked_budget')
    expect(harness.replay.calls).toHaveLength(0)
    expect(result.outcomes[0]?.qa).toMatchObject({
      verdict: 'flagged',
      reviewed: false,
      faithfulness: null,
    })
    expect(result.outcomes[0]?.qa.gates.find((gate) => gate.gate === 'faithfulness')?.outcome).toBe(
      'skipped',
    )
    expect(result.warnings.map((entry) => entry.code)).toContain('qa_failed')
  })

  it('hands back the text P6 vouched for when the run stops before the edit is re-verified', async () => {
    const { world, harness, run } = setUp({
      judgeEdits: [
        { block_index: 1, kind: 'replace', instruction: 'Define first.', replacement: null },
      ],
      edit: () => ({
        changes: [
          {
            block_index: 1,
            kind: 'replace',
            content:
              'Definamos primero el término. La memoria de trabajo retiene unos cuatro elementos a la vez. [cite:B01] Los elementos se agrupan en unidades mayores. [cite:B01]',
          },
        ],
        notes: [],
      }),
    })
    // P6, P7 and P8 go through; the fourth check — the P6 re-run — hits the cap.
    let checks = 0
    const budget: BudgetGuard = {
      capUsd: 1,
      spentUsd: () => 0,
      add: () => {},
      wouldExceed: () => ++checks > 3,
    }
    const result = await run({
      lessons: [lessonInput(world, 0)],
      budget,
      perCallEstimateUsd: 0.01,
    })
    expect(harness.replay.calls.map((call) => call.schemaName)).toEqual([
      'faithfulness',
      'pedagogy_judge',
      'edit_lesson',
    ])
    expect(result.status).toBe('blocked_budget')
    const [outcome] = result.outcomes
    // The rewrite P8 made was never verified, so it is not what goes out.
    expect(outcome?.theory.blocks[1]?.content).toBe(theory().blocks[1]?.content)
    expect(outcome?.qa).toMatchObject({ verdict: 'flagged', reviewed: false })
    expect(outcome?.qa.gates.find((gate) => gate.gate === 'edit')?.outcome).toBe('skipped')
  })

  it('flags a lesson whose gate asked for a fix nobody could apply', async () => {
    const { world, run } = setUp({})
    const [concept] = [...world.concepts.values()]
    const result = await run({
      lessons: [
        lessonInput(world, 0, {
          concepts: [
            {
              ...(concept as NonNullable<typeof concept>),
              id: 'c-missing',
              name: 'potencial de acción',
              aliases: [],
            },
          ],
        }),
      ],
    })
    const [outcome] = result.outcomes
    expect(outcome?.qa).toMatchObject({
      faithfulness: 1,
      coverage_ok: false,
      verdict: 'flagged',
      reviewed: true,
    })
    expect(outcome?.qa.findings.map((finding) => finding.kind)).toContain('concept_uncovered')
  })

  it('replays a second run entirely from the result cache', async () => {
    const { world, harness, run } = setUp({})
    await run({ lessons: [lessonInput(world, 0)] })
    const calls = harness.replay.calls.length
    const again = await run({ lessons: [lessonInput(world, 0)] })
    expect(harness.replay.calls.length).toBe(calls)
    expect(again.outcomes[0]?.qa.cost.cache_hits).toBe(2)
    expect(again.outcomes[0]?.qa.cost.calls).toBe(0)
  })

  it('finds an exercise another lesson already asks, and drops it when the block can spare it', async () => {
    const { world, repos, run } = setUp({}, { seedActivities: false })
    const own = world.rows.lessons[0] as (typeof world.rows.lessons)[number]
    const other = world.rows.lessons[1] as (typeof world.rows.lessons)[number]
    repos.rows.activities.push(
      activityRow(other.id, 0, '¿Cuántos elementos retiene la memoria de trabajo?'),
      ...Array.from({ length: 5 }, (_, index) =>
        activityRow(
          own.id,
          index,
          index === 0 ? '¿Cuántos elementos retiene la memoria de trabajo?' : `Pregunta ${index}`,
          index === 1 ? 'mcq_single' : index === 2 ? 'cloze_typed' : 'short_answer',
        ),
      ),
    )
    const result = await run({ lessons: [lessonInput(world, 0)] })
    const [outcome] = result.outcomes
    expect(outcome?.qa.findings.map((finding) => finding.kind)).toContain('activity_duplicate')
    expect(outcome?.duplicateActivityIds).toEqual([`act-${own.id}-0`])
  })

  it('finds a twin inside the same group, and the later lesson is the copy', async () => {
    const { world, repos, run } = setUp({}, { seedActivities: false })
    const first = world.rows.lessons[0] as (typeof world.rows.lessons)[number]
    const second = world.rows.lessons[1] as (typeof world.rows.lessons)[number]
    for (const lesson of [first, second]) {
      repos.rows.activities.push(
        ...Array.from({ length: 5 }, (_, index) =>
          activityRow(
            lesson.id,
            index,
            index === 0
              ? '¿Cuántos elementos retiene la memoria de trabajo?'
              : `Pregunta ${index} de ${lesson.specId}`,
            index === 1 ? 'mcq_single' : index === 2 ? 'cloze_typed' : 'short_answer',
          ),
        ),
      )
    }
    const result = await run({ lessons: [lessonInput(world, 0), lessonInput(world, 1)] })
    const [one, two] = result.outcomes
    expect(one?.qa.findings.map((finding) => finding.kind)).not.toContain('activity_duplicate')
    expect(one?.duplicateActivityIds).toEqual([])
    expect(two?.qa.findings.map((finding) => finding.kind)).toContain('activity_duplicate')
    expect(two?.duplicateActivityIds).toEqual([`act-${second.id}-0`])
  })
})
