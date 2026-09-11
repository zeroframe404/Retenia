import { createActivityAuthor, makeActivitiesOutputSchema } from '@retenia/activity-ai'
import {
  EDIT_LESSON_SCHEMA_NAME,
  EXTRACT_CHUNK_SCHEMA_NAME,
  editLessonOutputSchema,
  extractChunkOutputSchema,
  FAITHFULNESS_SCHEMA_NAME,
  faithfulnessOutputSchema,
  MAKE_FLASHCARDS_SCHEMA_NAME,
  makeFlashcardsOutputSchema,
  PEDAGOGY_JUDGE_SCHEMA_NAME,
  pedagogyJudgeOutputSchema,
  SYNTHESIZE_MODULE_SCHEMA_NAME,
  SYNTHESIZE_OUTLINE_SCHEMA_NAME,
  synthesizeModuleOutputSchema,
  synthesizeOutlineOutputSchema,
  WRITE_LESSON_SCHEMA_NAME,
  writeLessonOutputSchema,
} from '@retenia/pathgen'
import { describe, expect, it } from 'vitest'
import {
  createE2eFakeInvoker,
  E2E_JUDGE_MODEL_ID,
  E2E_MODEL_ID,
  e2eFakeProfile,
  e2eFakeRegistry,
} from './e2e-fake-ai'

/**
 * The E2E-only deterministic invoker (`docs/spec/04-path-generation.md` §13's Playwright
 * acceptance: "wizard → preview → freeze with fakes") — every answer it can be asked for must
 * actually validate against the real schema a live generation run checks it with, or the run
 * itself would be the only place a bad canned answer ever surfaced.
 */

const target = { profile: e2eFakeProfile(), modelId: E2E_MODEL_ID, apiKey: '' }

/** The `citable` block as `theory-task.ts` renders it: the fake reads these ids back out,
 *  so the citations P3 and P5 return resolve to a fragment that exists. */
const CITABLE_TASK = `## citable
- B01 (p. 3) Libro > Cap. 1`

async function invoke(
  invoker: ReturnType<typeof createE2eFakeInvoker>,
  request: Parameters<typeof invoker>[1],
) {
  const outcome = await invoker(target, request, { signal: undefined })
  if (outcome.kind !== 'ok') throw new Error(`expected an ok outcome, got ${outcome.kind}`)
  return JSON.parse(outcome.text) as unknown
}

describe('e2eFakeRegistry()', () => {
  it('routes both text roles at the fake, keyless profile', () => {
    const registry = e2eFakeRegistry()
    expect(registry.profiles).toHaveLength(1)
    expect(registry.profiles[0]?.keyRef).toBeNull()
    expect(registry.roles.cheap?.primary.profileId).toBe('e2e-fake')
    expect(registry.roles.smart?.primary.profileId).toBe('e2e-fake')
  })

  it('routes the judge at its own model id, so the bias guard lets it judge', () => {
    const registry = e2eFakeRegistry()
    expect(registry.roles.judge?.primary).toEqual({
      profileId: 'e2e-fake',
      modelId: E2E_JUDGE_MODEL_ID,
    })
    expect(E2E_JUDGE_MODEL_ID).not.toBe(E2E_MODEL_ID)
    expect(registry.profiles[0]?.models).toContain(E2E_JUDGE_MODEL_ID)
  })
})

describe('createE2eFakeInvoker()', () => {
  it('answers extract_chunk@1 with a schema-valid extraction carrying real concepts', async () => {
    const invoker = createE2eFakeInvoker()
    const answer = await invoke(invoker, {
      prompt: 'irrelevant',
      temperature: 0,
      schemaName: EXTRACT_CHUNK_SCHEMA_NAME,
    })
    const parsed = extractChunkOutputSchema.parse(answer)
    expect(parsed.concepts.length).toBeGreaterThan(0)
  })

  it('answers synthesize_outline@1 with nodes read back from the cache prefix', async () => {
    const invoker = createE2eFakeInvoker()
    const cachePrefix = [
      'c_aaa | Concepto A | concept | imp 0.90 | diff 2 | first: "cap 1"',
      'c_bbb | Concepto B | concept | imp 0.60 | diff 2 | first: "cap 1"',
    ].join('\n')
    const answer = await invoke(invoker, {
      prompt: 'irrelevant',
      temperature: 0,
      schemaName: SYNTHESIZE_OUTLINE_SCHEMA_NAME,
      cachePrefix,
    })
    const parsed = synthesizeOutlineOutputSchema.parse(answer)
    expect(parsed.graph.nodes.map((node) => node.concept_id).sort()).toEqual(['c_aaa', 'c_bbb'])
    expect(parsed.sections[0]?.modules[0]?.concept_ids.sort()).toEqual(['c_aaa', 'c_bbb'])
  })

  it('falls back to a placeholder concept when the cache prefix carries none', async () => {
    const invoker = createE2eFakeInvoker()
    const answer = await invoke(invoker, {
      prompt: 'irrelevant',
      temperature: 0,
      schemaName: SYNTHESIZE_OUTLINE_SCHEMA_NAME,
    })
    expect(() => synthesizeOutlineOutputSchema.parse(answer)).not.toThrow()
  })

  it('answers write_lesson@1 with theory that cites an id the task actually listed', async () => {
    const invoker = createE2eFakeInvoker()
    // The `citable` block as `theory-task.ts` renders it — the fake reads the ids back out so
    // the citations it returns resolve, which is the whole acceptance criterion of stage 7.
    const prompt = CITABLE_TASK
    const answer = await invoke(invoker, {
      prompt,
      temperature: 0.6,
      schemaName: WRITE_LESSON_SCHEMA_NAME,
    })

    const parsed = writeLessonOutputSchema.parse(answer)
    const explanation = parsed.blocks.find((block) => block.type === 'explanation')
    expect(explanation?.citations).toEqual(['B01'])
    expect(explanation?.content).toContain('[cite:B01]')
  })

  it('answers make_flashcards@1 with cards that validate and cite', async () => {
    const invoker = createE2eFakeInvoker()
    const answer = await invoke(invoker, {
      prompt: CITABLE_TASK,
      temperature: 0.3,
      schemaName: MAKE_FLASHCARDS_SCHEMA_NAME,
    })

    const parsed = makeFlashcardsOutputSchema.parse(answer)
    expect(parsed.flashcards.length).toBeGreaterThan(0)
    expect(parsed.flashcards[0]?.citations).toEqual(['B01'])
  })

  it('answers make_activities_choice with a candidate the real filter keeps', async () => {
    const invoker = createE2eFakeInvoker()
    const answer = await invoke(invoker, {
      prompt: 'irrelevant',
      temperature: 0.7,
      schemaName: 'make_activities_choice',
    })

    // Parsed with the narrowed family schema P4 is really called with, then run through the
    // author's own filter. Two of the four options used to carry no feedback, which `mcqIssue`
    // rejects — so the E2E run composed an empty practice block and nothing said so.
    const parsed = makeActivitiesOutputSchema('choice', ['mcq_single']).parse(answer)
    expect(parsed.candidates).toHaveLength(1)

    const author = createActivityAuthor({
      prompt: {
        template: '{{task}}',
        promptVersion: '1',
        schemaVersion: 'make_activities@1',
        role: 'smart',
        temperature: 0.7,
      },
    })
    const [call] = author.plan({
      lessonSpecId: 'L01',
      parentCustomId: 'p3-L01',
      lang: 'es-AR',
      title: 'Lección',
      objectives: [{ text: 'Explicar', bloom: 'understand' }],
      concepts: [{ id: 'e2e-concept', name: 'Concepto', definition: 'Definición.' }],
      blocks: [{ type: 'explanation', content: 'Texto.' }],
      misconceptions: [],
      families: ['choice'],
      wanted: 4,
      overGeneration: 2,
      alreadyGenerated: [],
      variant: 0,
    })
    const collected = author.collect(call as never, parsed as never)

    expect(collected.rejected).toEqual([])
    expect(collected.activities).toHaveLength(1)
  })

  it('matches the committed goldens for the three stage-7 prompts', async () => {
    const invoker = createE2eFakeInvoker()
    const golden = {
      P3_write_lesson: await invoke(invoker, {
        prompt: CITABLE_TASK,
        temperature: 0.6,
        schemaName: WRITE_LESSON_SCHEMA_NAME,
      }),
      P4_make_activities: await invoke(invoker, {
        prompt: 'irrelevant',
        temperature: 0.7,
        schemaName: 'make_activities_choice',
      }),
      P5_make_flashcards: await invoke(invoker, {
        prompt: CITABLE_TASK,
        temperature: 0.3,
        schemaName: MAKE_FLASHCARDS_SCHEMA_NAME,
      }),
      P6_faithfulness: await invoke(invoker, {
        prompt: 'claim_ids: c01, c02',
        temperature: 0,
        schemaName: FAITHFULNESS_SCHEMA_NAME,
      }),
      P7_pedagogy_judge: await invoke(invoker, {
        prompt: 'irrelevant',
        temperature: 0,
        schemaName: PEDAGOGY_JUDGE_SCHEMA_NAME,
      }),
      P8_edit: await invoke(invoker, {
        prompt: 'irrelevant',
        temperature: 0.3,
        schemaName: EDIT_LESSON_SCHEMA_NAME,
      }),
    }

    // The record step, in the shape `test/fixtures/book/p1-extractions.json` already uses:
    // `vitest -u` rewrites this, and a diff in it is a change to what every stage-7 test and
    // the Playwright run are answered with, which somebody has to look at.
    await expect(JSON.stringify(golden, null, 2)).toMatchFileSnapshot(
      '../../../test/fixtures/stage-7-answers.json',
    )
  })

  it('answers synthesize_module@1 with the concept ids parsed off the module task prompt', async () => {
    const invoker = createE2eFakeInvoker()
    const prompt = [
      'section: 1 of 1',
      'module: 1 of 1',
      'module_title: Módulo generado (e2e)',
      'concept_ids: c_aaa, c_bbb',
    ].join('\n')
    const answer = await invoke(invoker, {
      prompt,
      temperature: 0,
      schemaName: SYNTHESIZE_MODULE_SCHEMA_NAME,
    })
    const parsed = synthesizeModuleOutputSchema.parse(answer)
    expect(parsed.lesson_specs[0]?.concept_ids.sort()).toEqual(['c_aaa', 'c_bbb'])
    expect(parsed.lesson_specs[0]?.title).toContain('Módulo generado (e2e)')
  })
})

describe('createE2eFakeInvoker() — stage 8 (sub-phase 8.4)', () => {
  it('answers faithfulness@1 with one supported verdict per claim id the task listed', async () => {
    const invoker = createE2eFakeInvoker()
    const answer = await invoke(invoker, {
      prompt: ['lesson_id: L01', 'claim_ids: c01, c02, c03', ''].join(String.fromCharCode(10)),
      temperature: 0,
      schemaName: FAITHFULNESS_SCHEMA_NAME,
    })
    const parsed = faithfulnessOutputSchema.parse(answer)
    expect(parsed.claims.map((claim) => claim.id)).toEqual(['c01', 'c02', 'c03'])
    expect(parsed.claims.every((claim) => claim.verdict === 'supported')).toBe(true)
  })

  it('answers pedagogy_judge@1 with the five criteria and no edits', async () => {
    const invoker = createE2eFakeInvoker()
    const answer = await invoke(invoker, {
      prompt: 'irrelevant',
      temperature: 0,
      schemaName: PEDAGOGY_JUDGE_SCHEMA_NAME,
    })
    const parsed = pedagogyJudgeOutputSchema.parse(answer)
    expect(parsed.criteria).toHaveLength(5)
    expect(parsed.edits).toEqual([])
  })

  it('answers edit_lesson@1 with no changes', async () => {
    const invoker = createE2eFakeInvoker()
    const answer = await invoke(invoker, {
      prompt: 'irrelevant',
      temperature: 0.3,
      schemaName: EDIT_LESSON_SCHEMA_NAME,
    })
    expect(editLessonOutputSchema.parse(answer)).toEqual({ changes: [], notes: [] })
  })
})
