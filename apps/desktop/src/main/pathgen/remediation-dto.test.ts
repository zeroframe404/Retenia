import type { Lesson, PathRepository, PathVersion, Remediation } from '@retenia/core'
import {
  affectedLessonsDtoSchema,
  remediationDecisionDtoSchema,
  remediationDtoSchema,
  versionDiffDtoSchema,
} from '@retenia/ipc-contract'
import type { AffectedResult, RemediationDecision, VersionDiff } from '@retenia/pathgen'
import { describe, expect, it, vi } from 'vitest'
import {
  conceptNamesOf,
  createRemediationDtoBuilder,
  type RemediationDtoBuilder,
  toAffectedLessonsDto,
  toRemediationDecisionDto,
  toRemediationDto,
  toVersionDiffDto,
} from './remediation-dto'

/**
 * The remediation/regeneration DTO mappers (sub-phase 8.6): every mapper's output must be a
 * valid `RemediationDto`/`RemediationDecisionDto`/`VersionDiffDto`/`AffectedLessonsDto` per
 * `packages/ipc-contract`, the same discipline `dto.test.ts` uses for the rest of the bridge.
 */

const now = new Date('2026-09-11T12:00:00.000Z')

function makeRemediation(overrides: Partial<Remediation> = {}): Remediation {
  return {
    id: '019213cd-0000-7000-8000-000000000001',
    pathVersionId: '019213cd-0000-7000-8000-000000000002',
    moduleId: '019213cd-0000-7000-8000-000000000003',
    conceptId: 'c1',
    misconceptionId: 'X001',
    trigger: 'memory_lapses',
    status: 'active',
    refusal: null,
    anchorLessonId: '019213cd-0000-7000-8000-000000000004',
    lessonId: '019213cd-0000-7000-8000-000000000005',
    specId: 'L07.r1',
    evidence: { accuracy: 0.4, lapses: 2, mean_r: 0.61, failures: 2, context: 'diagnostic' },
    boost: {
      card_ids: ['c-1', 'c-2', 'c-3'],
      expires_at: '2026-09-25T00:00:00.000Z',
      clean: {},
      cleared: ['c-1'],
    },
    outcome: null,
    resolvedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deviceId: 'test',
    version: 1,
    ...overrides,
  }
}

function makeLesson(overrides: Partial<Lesson> = {}): Lesson {
  return {
    id: '019213cd-0000-7000-8000-000000000005',
    moduleId: '019213cd-0000-7000-8000-000000000003',
    ordinal: 1,
    specId: 'L07.r1',
    kind: 'remediation',
    parentLessonId: '019213cd-0000-7000-8000-000000000004',
    title: 'Repaso: c1',
    status: 'ready',
    objectives: [],
    conceptIds: ['c1'],
    prerequisiteLessonIds: [],
    estimatedMinutes: 4,
    theory: null,
    citations: [],
    qa: null,
    expansion: null,
    remediation: { position: 'before' },
    unlockRule: null,
    xpReward: 0,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deviceId: 'test',
    version: 1,
    ...overrides,
  }
}

function makeVersion(overrides: Partial<PathVersion> = {}): PathVersion {
  return {
    id: '019213cd-0000-7000-8000-000000000002',
    pathId: '019213cd-0000-7000-8000-000000000006',
    number: 1,
    spec: {} as unknown as PathVersion['spec'],
    knowledgeGraph: null,
    manifest: null,
    diff: null,
    frozenAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deviceId: 'test',
    version: 1,
    ...overrides,
  }
}

describe('toRemediationDto()', () => {
  it('maps an active detour: position, title, lessonStatus, anchorSpecId and conceptName', () => {
    const row = makeRemediation()
    const lesson = makeLesson()
    const dto = toRemediationDto(row, {
      lesson,
      anchorSpecId: 'L07',
      conceptName: 'Concepto uno',
    })

    expect(remediationDtoSchema.safeParse(dto).success).toBe(true)
    expect(dto.position).toBe('before')
    expect(dto.title).toBe('Repaso: c1')
    expect(dto.lessonStatus).toBe('ready')
    expect(dto.anchorSpecId).toBe('L07')
    expect(dto.conceptName).toBe('Concepto uno')
    expect(dto.estimatedMinutes).toBe(4)
  })

  it('reads the reasons off the evidence, clamping out-of-range numbers and nulling non-numbers', () => {
    const row = makeRemediation({
      evidence: { accuracy: 1.7, lapses: 2, mean_r: 0.61, failures: 2, context: 'diagnostic' },
    })
    const dto = toRemediationDto(row, { lesson: null, anchorSpecId: null, conceptName: 'c1' })
    expect(remediationDtoSchema.safeParse(dto).success).toBe(true)
    expect(dto.reasons).toEqual({
      accuracy: 1,
      lapses: 2,
      meanR: 0.61,
      failures: 2,
      context: 'diagnostic',
    })

    const junk = makeRemediation({
      evidence: { accuracy: 'high', lapses: 'two', mean_r: null, failures: undefined as never },
    })
    const dtoJunk = toRemediationDto(junk, { lesson: null, anchorSpecId: null, conceptName: 'c1' })
    expect(remediationDtoSchema.safeParse(dtoJunk).success).toBe(true)
    expect(dtoJunk.reasons).toEqual({
      accuracy: null,
      lapses: null,
      meanR: null,
      failures: null,
      context: null,
    })
  })

  it('exposes evidence.revisit_lesson_id as revisitLessonId only for a revisit_core refusal', () => {
    const revisitId = '019213cd-0000-7000-8000-000000000099'
    const row = makeRemediation({
      status: 'refused',
      refusal: 'revisit_core',
      evidence: { revisit_lesson_id: revisitId },
    })
    const dto = toRemediationDto(row, { lesson: null, anchorSpecId: null, conceptName: 'c1' })
    expect(remediationDtoSchema.safeParse(dto).success).toBe(true)
    expect(dto.revisitLessonId).toBe(revisitId)

    // Another refusal kind never surfaces it, even if the field happens to be present.
    const other = makeRemediation({
      status: 'refused',
      refusal: 'weekly_limit',
      evidence: { revisit_lesson_id: revisitId },
    })
    const otherDto = toRemediationDto(other, {
      lesson: null,
      anchorSpecId: null,
      conceptName: 'c1',
    })
    expect(otherDto.revisitLessonId).toBeNull()

    // No refusal at all: null too.
    const active = makeRemediation({ evidence: { revisit_lesson_id: revisitId } })
    const activeDto = toRemediationDto(active, {
      lesson: null,
      anchorSpecId: null,
      conceptName: 'c1',
    })
    expect(activeDto.revisitLessonId).toBeNull()
  })

  it('boostedCards is card_ids minus cleared, and never negative', () => {
    const row = makeRemediation({
      boost: { card_ids: ['c-1', 'c-2', 'c-3'], expires_at: null, clean: {}, cleared: ['c-1'] },
    })
    const dto = toRemediationDto(row, { lesson: null, anchorSpecId: null, conceptName: 'c1' })
    expect(dto.boostedCards).toBe(2)

    // More cleared than raised (should not happen, but the mapper must not go negative).
    const overCleared = makeRemediation({
      boost: { card_ids: ['c-1'], expires_at: null, clean: {}, cleared: ['c-1', 'c-2'] },
    })
    const overDto = toRemediationDto(overCleared, {
      lesson: null,
      anchorSpecId: null,
      conceptName: 'c1',
    })
    expect(overDto.boostedCards).toBe(0)
  })

  it('clips a long concept name to 500 characters', () => {
    const row = makeRemediation()
    const long = 'x'.repeat(800)
    const dto = toRemediationDto(row, { lesson: null, anchorSpecId: null, conceptName: long })
    expect(remediationDtoSchema.safeParse(dto).success).toBe(true)
    expect(dto.conceptName).toHaveLength(500)
  })
})

describe('createRemediationDtoBuilder()', () => {
  it('reads the concept name from the knowledge graph, and the anchor’s specId from its lesson', async () => {
    const version = makeVersion({
      knowledgeGraph: {
        version: 1,
        embedding_model_id: null,
        threshold: 0.9,
        nodes: [
          {
            concept_id: 'c1',
            canonical: 'Concepto Uno',
            aliases: [],
            definition: 'def',
            kind: 'concept',
            bloom_target: 'understand',
            difficulty: 3,
            importance: 0.5,
            source_refs: [],
          },
        ],
        edges: [],
      } as unknown as PathVersion['knowledgeGraph'],
    })
    const anchor = makeLesson({
      id: '019213cd-0000-7000-8000-000000000004',
      specId: 'L07',
      kind: 'core',
    })
    const own = makeLesson()
    const paths: Pick<PathRepository, 'findVersion' | 'findLesson'> = {
      findVersion: vi.fn(async () => version),
      findLesson: vi.fn(async (id: string) => (id === anchor.id ? anchor : own)),
    }
    const build = createRemediationDtoBuilder(paths)
    const row = makeRemediation()

    const dto = await build(row)
    expect(remediationDtoSchema.safeParse(dto).success).toBe(true)
    expect(dto.conceptName).toBe('Concepto Uno')
    expect(dto.anchorSpecId).toBe('L07')
  })

  it('falls back to the concept id when the graph has no matching node', async () => {
    const version = makeVersion({ knowledgeGraph: null })
    const paths: Pick<PathRepository, 'findVersion' | 'findLesson'> = {
      findVersion: vi.fn(async () => version),
      findLesson: vi.fn(async () => undefined),
    }
    const build = createRemediationDtoBuilder(paths)
    const row = makeRemediation({ conceptId: 'c-unknown', anchorLessonId: null, lessonId: null })

    const dto = await build(row)
    expect(remediationDtoSchema.safeParse(dto).success).toBe(true)
    expect(dto.conceptName).toBe('c-unknown')
    expect(dto.anchorSpecId).toBeNull()
  })

  it('uses the lesson passed in directly rather than reading it again', async () => {
    const version = makeVersion()
    const findLesson = vi.fn(async () => undefined)
    const paths: Pick<PathRepository, 'findVersion' | 'findLesson'> = {
      findVersion: vi.fn(async () => version),
      findLesson,
    }
    const build = createRemediationDtoBuilder(paths)
    const row = makeRemediation()
    const lesson = makeLesson({ title: 'Pasado directamente' })

    const dto = await build(row, lesson)
    expect(dto.title).toBe('Pasado directamente')
    // `findLesson` is only called for the anchor, never for `row.lessonId` when a lesson is given.
    expect(findLesson).toHaveBeenCalledTimes(1)
    expect(findLesson).toHaveBeenCalledWith(row.anchorLessonId)
  })
})

describe('toRemediationDecisionDto()', () => {
  const build: RemediationDtoBuilder = async (row, lesson) =>
    toRemediationDto(row, {
      lesson: lesson ?? null,
      anchorSpecId: null,
      conceptName: row.conceptId,
    })

  it('maps an inserted decision, building its DTO from the row and its lesson', async () => {
    const row = makeRemediation()
    const lesson = makeLesson()
    const decision: RemediationDecision = { kind: 'inserted', remediation: row, lesson }

    const dto = await toRemediationDecisionDto(decision, build)
    expect(remediationDecisionDtoSchema.safeParse(dto).success).toBe(true)
    expect(dto).toMatchObject({ kind: 'inserted', refusal: null })
    expect(dto.remediation?.id).toBe(row.id)
  })

  it('maps a refused decision with a logged row', async () => {
    const row = makeRemediation({ status: 'refused', refusal: 'weekly_limit' })
    const decision: RemediationDecision = {
      kind: 'refused',
      refusal: 'weekly_limit',
      remediation: row,
      revisitLessonId: null,
    }

    const dto = await toRemediationDecisionDto(decision, build)
    expect(remediationDecisionDtoSchema.safeParse(dto).success).toBe(true)
    expect(dto).toMatchObject({ kind: 'refused', refusal: 'weekly_limit' })
    expect(dto.remediation?.id).toBe(row.id)
  })

  it('maps a refused decision without a logged row (the same refusal already stood)', async () => {
    const decision: RemediationDecision = {
      kind: 'refused',
      refusal: 'duplicate_concept',
      remediation: null,
      revisitLessonId: null,
    }

    const dto = await toRemediationDecisionDto(decision, build)
    expect(remediationDecisionDtoSchema.safeParse(dto).success).toBe(true)
    expect(dto).toEqual({ kind: 'refused', refusal: 'duplicate_concept', remediation: null })
  })

  it('maps a failed decision, still building the row it tried to write', async () => {
    const row = makeRemediation()
    const decision: RemediationDecision = { kind: 'failed', remediation: row, error: 'boom' }

    const dto = await toRemediationDecisionDto(decision, build)
    expect(remediationDecisionDtoSchema.safeParse(dto).success).toBe(true)
    expect(dto).toMatchObject({ kind: 'failed', refusal: null })
    expect(dto.remediation?.id).toBe(row.id)
  })

  it('maps an ignored decision, and undefined the same way', async () => {
    const ignored = await toRemediationDecisionDto({ kind: 'ignored', reason: 'no signal' }, build)
    expect(remediationDecisionDtoSchema.safeParse(ignored).success).toBe(true)
    expect(ignored).toEqual({ kind: 'ignored', refusal: null, remediation: null })

    const undef = await toRemediationDecisionDto(undefined, build)
    expect(remediationDecisionDtoSchema.safeParse(undef).success).toBe(true)
    expect(undef).toEqual({ kind: 'ignored', refusal: null, remediation: null })
  })
})

describe('toVersionDiffDto()', () => {
  function makeDiff(overrides: Partial<VersionDiff> = {}): VersionDiff {
    return {
      version: 1,
      from_version: 1,
      to_version: 2,
      lessons: [
        {
          change: 'changed',
          spec_id: 'L01',
          title: 'Lección 1',
          previous_spec_id: 'L01',
          previous_title: 'Lección 1 (vieja)',
          added_concepts: ['c1'],
          removed_concepts: ['c2'],
          kept_concepts: ['c3'],
        },
      ],
      concepts: { added: ['c1'], removed: ['c2'], kept: 1 },
      summary: { unchanged: 0, changed: 1, added: 0, removed: 0 },
      ...overrides,
    }
  }

  it('maps snake_case to camelCase and resolves concept names only for referenced ids', () => {
    const names = new Map([
      ['c1', 'Concepto Uno'],
      ['c2', 'Concepto Dos'],
      ['c4', 'Concepto Cuatro (no referenciado)'],
    ])
    const dto = toVersionDiffDto(makeDiff(), names)
    expect(versionDiffDtoSchema.safeParse(dto).success).toBe(true)
    expect(dto.fromVersion).toBe(1)
    expect(dto.toVersion).toBe(2)
    expect(dto.lessons[0]).toMatchObject({
      specId: 'L01',
      previousSpecId: 'L01',
      previousTitle: 'Lección 1 (vieja)',
      addedConcepts: ['c1'],
      removedConcepts: ['c2'],
    })
    // c3 is kept on the lesson but is not in concepts.added/removed, so it is not referenced.
    expect(dto.conceptNames).toEqual({ c1: 'Concepto Uno', c2: 'Concepto Dos' })
  })

  it('falls back to the id itself when no name is known for a referenced concept', () => {
    const dto = toVersionDiffDto(makeDiff(), new Map())
    expect(versionDiffDtoSchema.safeParse(dto).success).toBe(true)
    expect(dto.conceptNames).toEqual({ c1: 'c1', c2: 'c2' })
  })

  it('bounds the lesson and concept lists', () => {
    const manyLessons = Array.from({ length: 2_100 }, (_, i) => ({
      change: 'unchanged' as const,
      spec_id: `L${i}`,
      title: `Lección ${i}`,
      previous_spec_id: `L${i}`,
      previous_title: `Lección ${i}`,
      added_concepts: [],
      removed_concepts: [],
      kept_concepts: [],
    }))
    const dto = toVersionDiffDto(makeDiff({ lessons: manyLessons }), new Map())
    expect(versionDiffDtoSchema.safeParse(dto).success).toBe(true)
    expect(dto.lessons.length).toBeLessThanOrEqual(2_000)
  })
})

describe('toAffectedLessonsDto()', () => {
  it('resolves source titles by id, falling back to the id when unknown', () => {
    const result: AffectedResult = {
      sources: [
        { sourceId: '019213cd-0000-7000-8000-000000000010', reason: 'blob_changed' },
        { sourceId: '019213cd-0000-7000-8000-000000000011', reason: 'missing' },
      ],
      lessons: [
        {
          lessonId: '019213cd-0000-7000-8000-000000000020',
          specId: 'L03',
          title: 'Lección 3',
          sourceIds: ['019213cd-0000-7000-8000-000000000010'],
          missingFragments: 2,
        },
      ],
    }
    const titles = new Map([['019213cd-0000-7000-8000-000000000010', 'El libro']])

    const dto = toAffectedLessonsDto(result, titles)
    expect(affectedLessonsDtoSchema.safeParse(dto).success).toBe(true)
    expect(dto.sources).toEqual([
      {
        sourceId: '019213cd-0000-7000-8000-000000000010',
        title: 'El libro',
        reason: 'blob_changed',
      },
      {
        sourceId: '019213cd-0000-7000-8000-000000000011',
        title: '019213cd-0000-7000-8000-000000000011',
        reason: 'missing',
      },
    ])
    expect(dto.lessons[0]).toMatchObject({ specId: 'L03', title: 'Lección 3', missingFragments: 2 })
  })
})

describe('conceptNamesOf()', () => {
  it('ignores a malformed graph and merges several graphs, first name winning per id', () => {
    const graphA = {
      version: 1,
      embedding_model_id: null,
      threshold: 0.9,
      nodes: [
        {
          concept_id: 'c1',
          canonical: 'De A',
          aliases: [],
          definition: 'd',
          kind: 'concept',
          bloom_target: 'understand',
          difficulty: 1,
          importance: 0.5,
          source_refs: [],
        },
      ],
      edges: [],
    }
    const graphB = {
      version: 1,
      embedding_model_id: null,
      threshold: 0.9,
      nodes: [
        {
          concept_id: 'c1',
          canonical: 'De B',
          aliases: [],
          definition: 'd',
          kind: 'concept',
          bloom_target: 'understand',
          difficulty: 1,
          importance: 0.5,
          source_refs: [],
        },
      ],
      edges: [],
    }
    const names = conceptNamesOf(null, 'not a graph', graphA, graphB)
    expect(names.get('c1')).toBe('De A')
  })
})
