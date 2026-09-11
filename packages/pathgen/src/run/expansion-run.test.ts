import type { Clock, GenerationRun, NewEntity, PathVersion } from '@retenia/core'
import { createUuidV7Generator } from '@retenia/core'
import { describe, expect, it } from 'vitest'
import type { ActivityAuthor } from '../expand/activity-author'
import { SYNCHRONOUS_HEAD_LESSONS } from '../expand/expand-lessons'
import { asJson } from '../json'
import { silentLogger } from '../logger'
import type { MakeFlashcardsOutput } from '../schemas/flashcards'
import type { WriteLessonOutput } from '../schemas/lesson'
import { type GenerationManifest, MANIFEST_VERSION } from '../schemas/manifest'
import { createAiHarness, HARNESS_NOW } from '../testing/ai-harness'
import { createExpandRepos } from '../testing/expand-repos'
import { expandWorld } from '../testing/expand-world'
import { testPrompts } from '../testing/extract-fixtures'
import { conceptsOf, createExpansionRun, type ExpansionRepos } from './expansion-run'

/**
 * A P1/P2 manifest exactly as `persist-draft.ts` would have written it before this path's
 * expansion ever ran — the baseline `mergeManifest` (in `expansion-run.ts`) merges stage 7/8
 * onto, never rewriting.
 */
const DRAFT_MANIFEST: GenerationManifest = {
  version: MANIFEST_VERSION,
  created_at: HARNESS_NOW.toISOString(),
  run_id: 'draft-run',
  stage: 'persisting',
  config: {},
  config_hash: '0'.repeat(64),
  source_hashes: [],
  prompt_versions: {},
  schema_versions: {
    extract_chunk: 'extract_chunk@1',
    synthesize_outline: 'synthesize_outline@1',
    synthesize_module: 'synthesize_module@1',
    knowledge_graph: 'knowledge_graph@1',
    path_draft: 'path_draft@1',
    manifest: 'generation_manifest@1',
  },
  models: {
    P1_extract_chunk: {
      provider: 'anthropic',
      model: 'claude-haiku',
      temperature: 0,
      seed: null,
      models_used: ['claude-haiku'],
    },
    P2_synthesize_outline: {
      provider: 'anthropic',
      model: 'claude-sonnet',
      temperature: 0.3,
      seed: null,
      models_used: ['claude-sonnet'],
    },
    P2_synthesize_module: {
      provider: 'anthropic',
      model: 'claude-sonnet',
      temperature: 0.3,
      seed: null,
      models_used: ['claude-sonnet'],
    },
  },
  embeddings: { model_id: null, dims: null, threshold: 0.85 },
  sequencing: { algorithm_version: '1', seed: 'seed-abc' },
  cost: {
    input_tokens: 1_000,
    output_tokens: 500,
    cached_tokens: 0,
    usd: 0.05,
    calls: 3,
    cache_hits: 0,
  },
  stats: {
    chunks_total: 4,
    chunks_in_scope: 4,
    chunks_frontmatter: 0,
    chunks_extracted: 4,
    chunks_reused: 0,
    chunks_failed: 0,
    concepts_raw: 1,
    concepts: 1,
    nodes: 1,
    edges: 0,
    sections: 1,
    modules: 1,
    lessons: 4,
  },
  warnings: [],
}

/**
 * The `generation_runs` row stage 7 owns.
 *
 * `expandLessons` is covered over the replay fakes in `expand/expand-lessons.test.ts`; what
 * this adds is the row around it — one `expanding` row per path version, the cost columns,
 * the resume, and the guard that stops two passes running over the same lessons at once.
 */

const clock: Clock = { now: () => HARNESS_NOW }

function theory(): WriteLessonOutput {
  const block = (
    type: WriteLessonOutput['blocks'][number]['type'],
    content: string,
    cited: boolean,
  ) => ({
    type,
    content,
    citations: cited ? ['B01'] : [],
    diagram: null,
    misconception_id: null,
  })
  return {
    blocks: [
      block('explanation', 'La capacidad es limitada. [cite:B01]', true),
      block('summary', 'Tres puntos.', true),
      block('hook', 'Por que se olvida?', false),
    ],
    glossary: [],
    word_count: 700,
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
        context_cue: null,
        concept_ids: ['c1'],
        importance: 'normal',
        interference_group: null,
        as_of: null,
        citations: ['B01'],
      },
    ],
    skipped: [],
  }
}

/** Returns nothing usable, so the practice block is empty and the run still completes. */
const emptyAuthor: ActivityAuthor = {
  plan: () => [],
  collect: () => ({ activities: [], rejected: [], notes: [] }),
}

function resolve(request: { prompt: string; schemaName?: string }): string | undefined {
  if (request.schemaName === 'write_lesson') return JSON.stringify(theory())
  if (request.schemaName === 'make_flashcards') {
    const lesson = /lesson_id: (\S+)/.exec(request.prompt)?.[1] ?? 'L00'
    return JSON.stringify(cards(`Que ensena ${lesson}?`))
  }
  return undefined
}

function setUp(
  options: {
    lessons?: number
    onLesson?: (event: { specId: string; status: string }) => void
    /** Seeds the version with a P1/P2 manifest, as `persist-draft.ts` would have written. */
    seedManifest?: boolean
  } = {},
) {
  const world = expandWorld(clock, { lessons: options.lessons ?? 4 })
  if (options.seedManifest === true) {
    const index = world.rows.versions.findIndex((row) => row.id === world.pathVersionId)
    const current = world.rows.versions[index] as PathVersion
    world.rows.versions[index] = { ...current, manifest: asJson(DRAFT_MANIFEST) }
  }
  const harness = createAiHarness({ resolve, clock, batch: false, pollsBeforeDone: 1 })
  const repos = createExpandRepos(clock, world.rows)
  const ids = createUuidV7Generator(clock)
  const rows: GenerationRun[] = []

  const runRepos: ExpansionRepos = {
    paths: {
      findVersion: async (id) => {
        const version = world.rows.versions.find((row) => row.id === id)
        return version === undefined
          ? undefined
          : {
              id: version.id,
              pathId: version.pathId,
              spec: version.spec,
              knowledgeGraph: version.knowledgeGraph,
              manifest: version.manifest,
            }
      },
      updateVersion: async (id, patch) => {
        const index = world.rows.versions.findIndex((row) => row.id === id)
        if (index === -1) throw new Error(`no path version ${id}`)
        const current = world.rows.versions[index] as PathVersion
        const updated: PathVersion = {
          ...current,
          ...(patch.manifest === undefined
            ? {}
            : { manifest: patch.manifest as PathVersion['manifest'] }),
          updatedAt: clock.now(),
          version: current.version + 1,
        }
        world.rows.versions[index] = updated
        return updated
      },
    },
    generationRuns: {
      findById: async (id) => rows.find((row) => row.id === id),
      findLatestByPath: async (pathId) => [...rows].reverse().find((row) => row.pathId === pathId),
      listActive: async () =>
        rows.filter((row) => !['completed', 'failed', 'cancelled'].includes(row.status)),
      create: async (input: NewEntity<GenerationRun>) => {
        const row = {
          ...input,
          id: ids.next(),
          createdAt: clock.now(),
          updatedAt: clock.now(),
          deletedAt: null,
          deviceId: 'test',
          version: 1,
        } as GenerationRun
        rows.push(row)
        return row
      },
      update: async (id, patch) => {
        const index = rows.findIndex((row) => row.id === id)
        const updated = { ...(rows[index] as GenerationRun), ...patch } as GenerationRun
        rows[index] = updated
        return updated
      },
    },
  }

  const handle = createExpansionRun({
    ai: harness.ai,
    registry: harness.registry,
    resultCache: harness.resultCache,
    author: emptyAuthor,
    repos,
    runs: runRepos,
    prompts: testPrompts,
    clock,
    timers: harness.timers,
    logger: silentLogger,
    ...(options.onLesson === undefined ? {} : { onLesson: options.onLesson }),
  })

  return { handle, harness, repos, rows, world }
}

describe('conceptsOf()', () => {
  it('is empty when the version has no knowledge graph to read', () => {
    expect(conceptsOf(null).size).toBe(0)
    expect(conceptsOf({ nodes: 'not a graph' }).size).toBe(0)
  })
})

describe('createExpansionRun()', () => {
  it('opens an `expanding` row, finishes it, and records what it spent', async () => {
    const set = setUp()
    const result = await set.handle.expand(set.world.pathVersionId)

    expect(result.status).toBe('completed')
    expect(result.stage.expanded).toBe(4)
    expect(set.rows).toHaveLength(1)
    const row = set.rows[0] as GenerationRun
    expect(row.pathVersionId).toBe(set.world.pathVersionId)
    expect(row.status).toBe('completed')
    expect(row.finishedAt).not.toBeNull()
    expect(row.costUsd).toBeGreaterThan(0)
    expect(row.inputTokens).toBeGreaterThan(0)
  })

  it('runs one expansion per version, however many times it is asked', async () => {
    const set = setUp()

    // The completion panel starts an expansion on mount, so a renderer reload asks twice
    // while the first is still in flight. Two passes would build the same `custom_id`s, miss
    // the same `ai_results` rows — nothing is written until an answer arrives — and pay for
    // every call a second time.
    const [first, second] = await Promise.all([
      set.handle.expand(set.world.pathVersionId),
      set.handle.expand(set.world.pathVersionId),
    ])

    expect(second.runId).toBe(first.runId)
    expect(set.rows).toHaveLength(1)
    // One P3 and one P5 per lesson, and nothing twice.
    expect(set.harness.replay.calls.length).toBe(4 * 2)
  })

  it('pays nothing for a version whose lessons are already written', async () => {
    const set = setUp()
    await set.handle.expand(set.world.pathVersionId)
    const paid = set.harness.replay.calls.length

    // A second attempt is a second row — `generation_runs` is a ledger of attempts, the same
    // way `pathgen.start` opens one per press. What must not happen is paying again: every
    // lesson is already `ready`, so there is nothing to expand.
    const again = await set.handle.expand(set.world.pathVersionId)

    expect(again.stage.reused).toBe(4)
    expect(again.stage.expanded).toBe(0)
    expect(set.harness.replay.calls.length).toBe(paid)
    expect(set.repos.rows.knowledgeItems).toHaveLength(4)
  })

  it('resumes a run the app died in the middle of, and pays for no lesson twice', async () => {
    // The kill fires the moment the synchronous head is written, so the batched tail is left
    // untouched and its lessons stay `pending` — the state a process that dies mid-run really
    // leaves behind, and the one the `custom_id`s and the `expanding` row exist to recover
    // from. The two "second run" tests above never reach it: every lesson is already `ready`,
    // so they take the early return before any replay or batch re-await happens.
    const kill = new AbortController()
    const ready: string[] = []
    const set = setUp({
      lessons: 6,
      onLesson: (event) => {
        if (event.status !== 'ready') return
        ready.push(event.specId)
        if (ready.length === SYNCHRONOUS_HEAD_LESSONS) kill.abort()
      },
    })

    const first = await set.handle.expand(set.world.pathVersionId, { signal: kill.signal })

    const answeredBeforeTheKill = [...set.harness.replay.answered]
    expect(answeredBeforeTheKill.length).toBeGreaterThan(0)
    expect(first.status).toBe('cancelled')
    expect(set.repos.rows.lessons.filter((lesson) => lesson.status === 'ready')).toHaveLength(
      SYNCHRONOUS_HEAD_LESSONS,
    )

    // A process that is killed never gets to write its terminal status, so the row it leaves
    // behind is still `expanding`; an abort *does* record `cancelled`, which is right for the
    // Cancelar button and wrong for a crash. Putting the row back is how the difference is
    // modelled here — and it is what makes the startup sweep find it.
    const row = set.rows.find((entry) => entry.id === first.runId) as GenerationRun
    set.rows[set.rows.indexOf(row)] = { ...row, status: 'expanding', finishedAt: null }

    const adopted = await set.handle.active()
    expect(adopted.map((entry) => entry.id)).toEqual([first.runId])

    const second = await set.handle.resume(first.runId)

    expect(second.status).toBe('completed')
    expect(second.stage.expanded + second.stage.reused).toBe(6)
    expect(set.repos.rows.lessons.every((lesson) => lesson.status === 'ready')).toBe(true)

    // The property the `custom_id`s exist for: nothing the first attempt already paid for is
    // asked again. Asserted as disjoint sets rather than as a call count, because a count also
    // passes when the second attempt repeats one call and happens to skip another.
    const answeredAfter = set.harness.replay.answered.slice(answeredBeforeTheKill.length)
    expect(answeredAfter.filter((id) => answeredBeforeTheKill.includes(id))).toEqual([])

    // One knowledge item per lesson, not two: the lessons the first attempt finished must not
    // re-create the cards they already have, which is what would throw away their FSRS state.
    expect(set.repos.rows.knowledgeItems).toHaveLength(6)
  })

  it('lists only the rows a startup sweep should adopt', async () => {
    const set = setUp()
    expect(await set.handle.active()).toEqual([])

    await set.handle.expand(set.world.pathVersionId)
    // A completed row is not picked up again.
    expect(await set.handle.active()).toEqual([])
  })

  it('refuses a version that does not exist', async () => {
    const set = setUp()
    await expect(set.handle.expand('00000000-0000-7000-8000-000000000000')).rejects.toThrow(
      /no path version/,
    )
  })

  it("merges this stage's models and cost onto the version's existing P1/P2 manifest", async () => {
    const set = setUp({ seedManifest: true })
    const result = await set.handle.expand(set.world.pathVersionId)

    const version = set.world.rows.versions.find((row) => row.id === set.world.pathVersionId)
    const manifest = version?.manifest as GenerationManifest | null | undefined
    expect(manifest).toBeDefined()
    expect(manifest).not.toBeNull()
    if (manifest === null || manifest === undefined) return

    // The pre-existing P1/P2 entries survive exactly as `persist-draft.ts` wrote them.
    expect(manifest.models.P1_extract_chunk).toEqual(DRAFT_MANIFEST.models.P1_extract_chunk)
    expect(manifest.models.P2_synthesize_outline).toEqual(
      DRAFT_MANIFEST.models.P2_synthesize_outline,
    )
    expect(manifest.models.P2_synthesize_module).toEqual(DRAFT_MANIFEST.models.P2_synthesize_module)

    // Every stage this run actually dispatched (P3, P5 — P4 is empty with `emptyAuthor`, and
    // no QA pipeline is wired in this suite) now has an entry with what it used.
    expect(Object.keys(result.stage.modelsByStage).sort()).toEqual(
      ['P3_write_lesson', 'P5_make_flashcards'].sort(),
    )
    for (const [stageId, modelsUsed] of Object.entries(result.stage.modelsByStage)) {
      expect(manifest.models[stageId]?.models_used).toEqual(modelsUsed)
    }

    // Cost accumulated on top of the seed manifest's own baseline, never replaced it.
    expect(manifest.cost.calls).toBe(DRAFT_MANIFEST.cost.calls + result.stage.calls)
    expect(manifest.cost.cache_hits).toBe(DRAFT_MANIFEST.cost.cache_hits + result.stage.cacheHits)
    expect(manifest.cost.input_tokens).toBe(
      DRAFT_MANIFEST.cost.input_tokens + result.stage.usage.inputTokens,
    )
    expect(manifest.cost.usd).toBeCloseTo(DRAFT_MANIFEST.cost.usd + result.stage.usage.usd, 6)

    // Everything else about the draft's manifest — what this stage has nothing truthful to
    // say about — is untouched.
    expect(manifest.run_id).toBe(DRAFT_MANIFEST.run_id)
    expect(manifest.source_hashes).toEqual(DRAFT_MANIFEST.source_hashes)
    expect(manifest.schema_versions).toEqual(DRAFT_MANIFEST.schema_versions)
  })

  it('leaves a version with no parseable manifest untouched', async () => {
    const set = setUp()
    await set.handle.expand(set.world.pathVersionId)

    const version = set.world.rows.versions.find((row) => row.id === set.world.pathVersionId)
    expect(version?.manifest).toBeNull()
  })
})
