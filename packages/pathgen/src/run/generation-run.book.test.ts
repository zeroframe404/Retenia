import { promptVersionSnapshot } from '@retenia/ai/prompts'
import { createFakeEmbeddingProvider } from '@retenia/core/testing'
import { describe, expect, it } from 'vitest'
import { BOOK_NOW, buildBook, type FixtureBook } from '../../test/fixtures/book/build-book'
import { silentLogger } from '../logger'
import { loadPathgenPrompts } from '../node'
import { PATHGEN_PROMPT_IDS } from '../prompts'
import { knowledgeGraphDocumentSchema } from '../schemas/knowledge-graph'
import { generationManifestSchema } from '../schemas/manifest'
import { type PathDraft, pathDraftSchema } from '../schemas/path-draft'
import { createAiHarness } from '../testing/ai-harness'
import { isAcyclic } from '../testing/invariants'
import { createMemoryRepos } from '../testing/memory-repos'
import { createGenerationRun, type GenerationResult } from './generation-run'

/**
 * The acceptance test of sub-phase 8.1, over the fixture book with the real prompt files:
 * a DAG outline of ≥ 20 lesson specs of 2–5 concepts, a second run that reuses every cached
 * result, and a manifest that lists every prompt version — plus the same draft whichever
 * way the calls were dispatched.
 */

const clock = { now: () => BOOK_NOW }
const prompts = loadPathgenPrompts()

function world(book: FixtureBook, options: { batch?: boolean } = {}) {
  const harness = createAiHarness({ resolve: book.resolve, clock, ...options })
  const repos = createMemoryRepos(clock, { sources: book.sources, chunks: book.chunks })
  const handle = createGenerationRun({
    ai: harness.ai,
    runner: harness.runner,
    resultCache: harness.resultCache,
    registry: harness.registry,
    repos,
    prompts,
    embeddings: createFakeEmbeddingProvider(),
    clock,
    timers: harness.timers,
    logger: silentLogger,
  })
  return { harness, repos, handle }
}

function lessonsOf(draft: PathDraft) {
  return draft.sections.flatMap((section) => section.modules.flatMap((module) => module.lessons))
}

function completed(result: GenerationResult): PathDraft {
  expect(result.error).toBeNull()
  expect(result.status).toBe('completed')
  return pathDraftSchema.parse(result.draft)
}

describe('a generation run over the fixture book', () => {
  const book = buildBook(prompts)

  it('produces a DAG outline of at least 20 lessons of 2–5 concepts, repairing every planted defect', async () => {
    const { harness, repos, handle } = world(book)
    const result = await handle.start(book.config)
    const draft = completed(result)

    // The acceptance criteria.
    const lessons = lessonsOf(draft)
    expect(lessons.length).toBeGreaterThanOrEqual(20)
    expect(draft.stats.lessons).toBe(lessons.length)
    for (const lesson of lessons) {
      expect(lesson.concept_ids.length).toBeGreaterThanOrEqual(2)
      expect(lesson.concept_ids.length).toBeLessThanOrEqual(5)
      expect(lesson.objectives.length).toBeGreaterThanOrEqual(1)
      expect(lesson.objectives.length).toBeLessThanOrEqual(3)
      expect(lesson.warmup_concept_ids.length).toBeLessThanOrEqual(1)
      expect(lesson.source_refs.length).toBeGreaterThan(0)
    }
    // Ids are positional and every prerequisite points backwards.
    const ids = lessons.map((lesson) => lesson.id)
    expect(ids).toEqual(ids.map((_, index) => `L${String(index + 1).padStart(2, '0')}`))
    for (const [index, lesson] of lessons.entries()) {
      for (const prerequisite of lesson.prerequisite_lesson_ids) {
        expect(ids.indexOf(prerequisite)).toBeLessThan(index)
      }
    }
    for (const section of draft.sections) {
      for (const module of section.modules) {
        expect(module.lessons.length).toBeGreaterThanOrEqual(3)
        expect(module.lessons.length).toBeLessThanOrEqual(7)
        expect(module.reinforcement.item_count).toBeGreaterThanOrEqual(10)
        expect(module.reinforcement.item_count).toBeLessThanOrEqual(15)
      }
    }
    expect(
      draft.final_exam.blueprint.topics.reduce((sum, topic) => sum + topic.weight, 0),
    ).toBeCloseTo(1, 9)

    // The graph is a DAG.
    const version = repos.rows.versions[0]
    const graph = knowledgeGraphDocumentSchema.parse(version?.knowledgeGraph)
    expect(isAcyclic(graph.edges.filter((edge) => edge.kind === 'PREREQ_OF'))).toBe(true)
    expect(graph.embedding_model_id).toBe('fake-hash-768')
    expect(graph.nodes.length).toBeGreaterThan(60)

    // Every planted defect was found and repaired.
    const codes = new Set(draft.warnings.map((entry) => entry.code))
    for (const code of [
      'injection_suspected',
      'chunk_excluded',
      'model_warning',
      'unknown_node',
      'dangling_edge',
      'cycle_broken',
      'coverage_gap',
      'lesson_split',
      'concept_repeated',
    ]) {
      expect(codes, code).toContain(code)
    }
    expect(draft.warnings.find((entry) => entry.code === 'cycle_broken')?.params.confidence).toBe(
      0.4,
    )
    expect(
      draft.warnings.find((entry) => entry.code === 'injection_suspected')?.params.chunk_id,
    ).toBe('chunk-ch08:s02')
    expect(draft.excluded).toEqual([
      { heading_path: 'Libro > Apéndice A: Tablas', reason: 'apéndice de tablas' },
    ])
    expect(
      draft.warnings
        .filter((entry) => entry.code === 'model_warning')
        .map((entry) => entry.params.text),
    ).toEqual(['capítulo 9 excluido: apéndice', 'este módulo quedó más largo de lo habitual'])
    expect(draft.misconceptions.length).toBeGreaterThanOrEqual(8)

    // The rows and the manifest.
    expect(repos.rows.paths[0]).toMatchObject({ status: 'draft', activeVersion: null })
    expect(version?.frozenAt).toBeNull()
    expect(repos.rows.runs[0]?.status).toBe('completed')
    const manifest = generationManifestSchema.parse(version?.manifest)
    expect(manifest.prompt_versions).toEqual(promptVersionSnapshot())
    for (const id of Object.values(PATHGEN_PROMPT_IDS))
      expect(manifest.prompt_versions[id]).toBe('1')
    expect(manifest.stats).toMatchObject({
      chunks_total: 51,
      chunks_in_scope: 51,
      chunks_frontmatter: 5,
      chunks_extracted: 46,
      chunks_failed: 0,
      lessons: lessons.length,
    })
    expect(manifest.cost.calls).toBe(46 + 1 + manifest.stats.modules)
    expect(manifest.cost.usd).toBeGreaterThan(0)
    expect(manifest.embeddings.model_id).toBe('fake-hash-768')

    // The cache holds every P1 and P2 answer under its custom id.
    const cached = [...harness.resultCache.entries.keys()]
    expect(cached.filter((id) => id.startsWith('P1_extract_chunk-'))).toHaveLength(46)
    expect(cached.filter((id) => id.startsWith('P2_synthesize_outline-'))).toHaveLength(1)
    expect(cached.filter((id) => id.startsWith('P2_synthesize_module-'))).toHaveLength(
      manifest.stats.modules,
    )

    // The record: the draft this pipeline produces from this book.
    await expect(JSON.stringify(draft, null, 2)).toMatchFileSnapshot(
      '../../test/fixtures/book/path-draft.json',
    )
  })

  it('reuses every cached result on a second run — zero new AI calls — and produces the same draft', async () => {
    const { harness, handle } = world(book)
    const first = completed(await handle.start(book.config))
    const calls = harness.replay.calls.length
    const second = await handle.start(book.config)
    expect(harness.replay.calls).toHaveLength(calls)
    expect(harness.replayBatch.polls()).toBe(0)
    expect(completed(second)).toEqual(first)
    expect(second.manifest?.cost).toMatchObject({ calls: 0, usd: 0 })
    expect(second.manifest?.cost.cache_hits).toBe(46 + 1 + (second.manifest?.stats.modules ?? 0))
  })

  it('produces the same draft through the batch path as through the synchronous one', async () => {
    const sync = completed(await world(book).handle.start(book.config))
    const { harness, repos, handle } = world(book, { batch: true })
    const batched = completed(await handle.start(book.config, { userWaiting: false }))
    expect(harness.replayBatch.submitted).toHaveLength(1)
    expect(harness.replayBatch.submitted[0]).toHaveLength(46)
    expect(repos.rows.runs[0]?.progress).toMatchObject({ user_waiting: false })
    expect(batched).toEqual(sync)
  })

  it('is deterministic without the planted defects as well', async () => {
    const clean = buildBook(prompts, { defects: false })
    const a = completed(await world(clean).handle.start(clean.config))
    const b = completed(await world(clean).handle.start(clean.config))
    expect(a).toEqual(b)
    expect(a.warnings.map((entry) => entry.code)).not.toContain('cycle_broken')
    expect(lessonsOf(a).length).toBeGreaterThanOrEqual(20)
  })
})
