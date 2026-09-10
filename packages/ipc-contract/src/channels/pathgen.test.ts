import { describe, expect, it } from 'vitest'
import { contract } from '../index'
import {
  GENERATION_RUN_STATUSES,
  GENERATION_STAGES,
  generationConfigInputSchema,
  pathDraftDtoSchema,
  pathEditOpDtoSchema,
} from './pathgen'

const baseConfig = {
  goal: 'Aprobar el parcial',
  level: 'beginner',
  primarySourceId: 'src-1',
  sourceIds: ['src-1'],
}

describe('generation run vocabulary', () => {
  /**
   * These lists exist in three places — here, `packages/pathgen`'s `GENERATION_STAGES` and
   * `packages/db`'s `GENERATION_RUN_STATUSES` — because the architecture forbids this leaf
   * package from importing either. `packages/pathgen` and `packages/db` carry the matching
   * parity assertions on their own side.
   */
  it('matches packages/db’s GENERATION_RUN_STATUSES', () => {
    expect([...GENERATION_RUN_STATUSES]).toEqual([
      'queued',
      'extracting',
      'consolidating',
      'synthesizing',
      'sequencing',
      'persisting',
      'expanding',
      'completed',
      'failed',
      'cancelled',
      'blocked_budget',
    ])
  })

  it('matches packages/pathgen’s GENERATION_STAGES', () => {
    expect([...GENERATION_STAGES]).toEqual([
      'reading_sources',
      'extracting',
      'consolidating',
      'synthesizing',
      'synthesizing_modules',
      'sequencing',
      'persisting',
      'expanding_theory',
      'expanding_practice',
      'expanding_flashcards',
    ])
  })
})

describe('generationConfigInputSchema', () => {
  it('accepts the wizard’s minimal template', () => {
    expect(generationConfigInputSchema.safeParse(baseConfig).success).toBe(true)
  })

  it('rejects a primary source absent from sourceIds', () => {
    const result = generationConfigInputSchema.safeParse({
      ...baseConfig,
      primarySourceId: 'other',
    })
    expect(result.success).toBe(false)
  })

  it('rejects duplicate sourceIds', () => {
    const result = generationConfigInputSchema.safeParse({
      ...baseConfig,
      sourceIds: ['src-1', 'src-1'],
    })
    expect(result.success).toBe(false)
  })
})

describe('pathgen.quote / pathgen.start', () => {
  it('takes the same config shape on both channels', () => {
    expect(contract['pathgen.quote'].input.safeParse({ config: baseConfig }).success).toBe(true)
    expect(contract['pathgen.start'].input.safeParse({ config: baseConfig }).success).toBe(true)
  })
})

describe('pathEditOpDtoSchema', () => {
  it('accepts every op kind', () => {
    const ops = [
      { kind: 'rename', nodeId: 'S01', title: 'x' },
      { kind: 'reorder', nodeId: 'S01', toIndex: 0 },
      { kind: 'exclude', nodeId: 'S01' },
      { kind: 'markKnown', nodeId: 'S01' },
      { kind: 'unmarkKnown', nodeId: 'S01' },
      { kind: 'mergeLessons', lessonIds: ['L01', 'L02'] },
      { kind: 'splitLesson', lessonId: 'L01', parts: 2 },
      { kind: 'deepenLesson', lessonId: 'L01', parts: 3 },
      { kind: 'setPrimarySource', sourceId: 'src-1' },
    ]
    for (const op of ops) {
      expect(pathEditOpDtoSchema.safeParse(op).success, JSON.stringify(op)).toBe(true)
    }
  })

  it('rejects a splitLesson/deepenLesson parts count outside {2, 3}', () => {
    expect(
      pathEditOpDtoSchema.safeParse({ kind: 'splitLesson', lessonId: 'L01', parts: 4 }).success,
    ).toBe(false)
  })

  it('rejects mergeLessons with fewer than two ids', () => {
    expect(
      pathEditOpDtoSchema.safeParse({ kind: 'mergeLessons', lessonIds: ['L01'] }).success,
    ).toBe(false)
  })
})

describe('pathgen.editDraft / pathgen.freeze', () => {
  it('reference the same pathVersionId shape', () => {
    const id = '019213cd-0000-7000-8000-000000000001'
    expect(
      contract['pathgen.editDraft'].input.safeParse({
        pathVersionId: id,
        op: { kind: 'rename', nodeId: 'S01', title: 'x' },
      }).success,
    ).toBe(true)
    expect(contract['pathgen.freeze'].input.safeParse({ pathVersionId: id }).success).toBe(true)
    expect(
      contract['pathgen.freeze'].input.safeParse({ pathVersionId: 'not-a-uuid' }).success,
    ).toBe(false)
  })
})

describe('pathDraftDtoSchema', () => {
  it('requires known_node_ids even though it defaults on the source schema', () => {
    // The DTO does not apply defaults (a wire schema should reject a missing field rather than
    // silently invent one); main always sends a fully-materialized draft.
    const { known_node_ids: _omitted, ...withoutKnown } = minimalDraft()
    expect(pathDraftDtoSchema.safeParse(withoutKnown).success).toBe(false)
    expect(pathDraftDtoSchema.safeParse(minimalDraft()).success).toBe(true)
  })
})

function minimalDraft() {
  return {
    version: 1,
    kind: 'draft',
    title: 't',
    language: 'es-AR',
    target_language: null,
    level: 'l',
    goal: 'g',
    target_date: null,
    sources: [{ source_id: 's', title: 't', primary: true }],
    sections: [],
    final_exam: {
      id: 'FINAL',
      kind: 'final_exam',
      blueprint: { topics: [], item_count: 0 },
      estimated_minutes: 0,
    },
    misconceptions: [],
    excluded: [],
    stats: {
      sections: 0,
      modules: 0,
      lessons: 0,
      checkpoints: 0,
      concepts: 0,
      minutes: 0,
      weeks_estimate: null,
    },
    warnings: [],
    known_node_ids: [],
  }
}
