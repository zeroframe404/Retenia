import type { Clock, GenerationRun, NewEntity } from '@retenia/core'
import { createUuidV7Generator } from '@retenia/core'
import { describe, expect, it } from 'vitest'
import type { ActivityAuthor } from '../expand/activity-author'
import { silentLogger } from '../logger'
import type { MakeFlashcardsOutput } from '../schemas/flashcards'
import type { WriteLessonOutput } from '../schemas/lesson'
import { createAiHarness, HARNESS_NOW } from '../testing/ai-harness'
import { createExpandRepos } from '../testing/expand-repos'
import { expandWorld } from '../testing/expand-world'
import { testPrompts } from '../testing/extract-fixtures'
import { conceptsOf, createExpansionRun, type ExpansionRepos } from './expansion-run'

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

function setUp() {
  const world = expandWorld(clock, { lessons: 4 })
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
            }
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
})
