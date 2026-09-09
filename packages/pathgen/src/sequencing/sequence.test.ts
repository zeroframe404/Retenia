import { describe, expect, it } from 'vitest'
import {
  chunk,
  context,
  edge,
  lesson,
  moduleSpec,
  nodeAt,
  outline,
  PRIMARY,
  SECONDARY,
  section,
} from '../testing/graph-fixtures'
import { validateSynthesis } from '../validate/validate'
import { orderedSources, resolveSequencingLimits, sequencePath } from './sequence'
import { DEFAULT_SEQUENCING_LIMITS, type SequencingConfig } from './types'

/** Twelve concepts over ten chunks, two modules of three two-concept lessons. */
const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']
const graph = {
  nodes: ids.map((id, index) => nodeAt(id, `c${index}`, { importance: 0.4 + (index % 4) * 0.2 })),
  edges: [edge('a', 'c', 0.9), edge('c', 'g', 0.8), edge('k', 'e', 0.3), edge('e', 'k', 0.9)],
}
const spec = outline(
  [
    section('Bases', [
      moduleSpec('Memoria', [
        lesson('Uno', ['a', 'b'], { estimated_minutes: 8 }),
        lesson('Dos', ['c', 'd'], { estimated_minutes: 25 }),
        lesson('Tres', ['e', 'f'], { estimated_minutes: null }),
      ]),
      moduleSpec('Olvido', [
        lesson('Cuatro', ['g', 'h']),
        lesson('Cinco', ['i', 'j']),
        lesson('Seis', ['k', 'l']),
      ]),
    ]),
  ],
  { warnings: ['nota del modelo'] },
)
const config: SequencingConfig = {
  primarySourceId: PRIMARY,
  sourceIds: [SECONDARY, PRIMARY],
  paceHoursPerWeek: 2,
  forExam: null,
}
const now = new Date('2026-09-09T12:00:00Z')
/** Forty chunks in the primary source, so every concept has a position of its own. */
const wide = context(Array.from({ length: 40 }, (_, index) => chunk(`c${index}`, index)))

function build(overrides: Partial<SequencingConfig> = {}, seed = 'inputs-digest') {
  const validated = validateSynthesis(graph, spec, wide)
  return sequencePath(validated, { ...config, ...overrides }, { seed, now })
}

function lessonsOf(draft: ReturnType<typeof build>['draft']) {
  return draft.sections.flatMap((entry) => entry.modules.flatMap((module) => module.lessons))
}

describe('sequencePath()', () => {
  it('produces numbered sections, modules and lessons in a valid order', () => {
    const { draft } = build()
    expect(draft.sections.map((entry) => entry.id)).toEqual(['S01'])
    expect(draft.sections[0]?.modules.map((module) => module.id)).toEqual(['M01', 'M02'])
    const lessons = lessonsOf(draft)
    expect(lessons.map((entry) => entry.id)).toEqual(['L01', 'L02', 'L03', 'L04', 'L05', 'L06'])
    expect(lessons.map((entry) => entry.concept_ids)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
      ['g', 'h'],
      ['i', 'j'],
      ['k', 'l'],
    ])
    // a → c and c → g cross lessons and modules and are honoured; the e ⇄ k cycle was broken
    // in validation at the weaker edge, so only e → k remains.
    expect(lessons.map((entry) => entry.prerequisite_lesson_ids)).toEqual([
      [],
      ['L01'],
      [],
      ['L02'],
      [],
      ['L03'],
    ])
    expect(draft.warnings).toEqual([])
    expect(lessons[0]?.source_refs.map((ref) => ref.chunk_id)).toEqual(['c0', 'c1'])
    expect(lessons[0]).toMatchObject({ kind: 'core', title: 'Uno', origin: 'model' })
  })

  it('clamps minutes, warms up at most one concept per lesson, and adds the nodes', () => {
    const { draft } = build()
    const [memoria, olvido] = draft.sections[0]?.modules ?? []
    expect(memoria?.lessons.map((entry) => entry.estimated_minutes)).toEqual([8, 20, 12])
    for (const entry of lessonsOf(draft)) {
      expect(entry.warmup_concept_ids.length).toBeLessThanOrEqual(1)
    }
    // Lesson three can reach `a` and `b`; `b` is the important one.
    expect(memoria?.lessons.map((entry) => entry.warmup_concept_ids)).toEqual([[], [], ['b']])
    expect(memoria?.reinforcement).toMatchObject({
      id: 'M01.reinf',
      module_id: 'M01',
      item_count: 10,
      earlier_concept_ids: [],
    })
    expect(memoria?.concept_ids).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(olvido?.reinforcement.earlier_concept_ids.length).toBeGreaterThan(0)
    expect(memoria?.checkpoint).toBeNull()
    expect(olvido?.checkpoint).toBeNull()
    expect(memoria?.estimated_minutes).toBe(8 + 20 + 12 + 10)
    expect(draft.final_exam.blueprint.topics.map((topic) => topic.module_id)).toEqual([
      'M01',
      'M02',
    ])
    expect(
      draft.final_exam.blueprint.topics.reduce(
        (sum, topic) => sum + Math.round(topic.weight * 100),
        0,
      ),
    ).toBe(100)
  })

  it('totals the minutes, estimates the weeks, and warns when an exam date is too close', () => {
    const fits = build({ forExam: { date: '2027-06-01' } })
    expect(fits.draft.stats).toMatchObject({
      sections: 1,
      modules: 2,
      lessons: 6,
      checkpoints: 0,
      concepts: 12,
    })
    expect(fits.draft.stats.minutes).toBeGreaterThan(0)
    expect(fits.draft.stats.weeks_estimate).toBe(Math.ceil(fits.draft.stats.minutes / 120))
    expect(fits.draft.warnings).toEqual([])

    const tight = build({ forExam: { date: '2026-09-10' } })
    expect(tight.draft.warnings).toEqual([
      {
        code: 'exam_date_overshoot',
        stage: 'sequence',
        params: {
          weeks_estimate: tight.draft.stats.weeks_estimate as number,
          weeks_available: 0.1,
          target_date: '2026-09-10',
        },
      },
    ])

    const noPace = build({ paceHoursPerWeek: 0, forExam: { date: '2026-09-10' } })
    expect(noPace.draft.stats.weeks_estimate).toBeNull()
    expect(noPace.draft.warnings).toEqual([])
  })

  it('returns the graph without the edges the hierarchy had to drop', () => {
    const { graph: pruned } = build()
    expect(pruned.edges).toEqual([edge('a', 'c', 0.9), edge('c', 'g', 0.8), edge('e', 'k', 0.9)])
  })

  it('is byte-identical for the same inputs and keeps its shape under another seed', () => {
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()))
    const other = build({}, 'another-digest')
    expect(other.draft.stats).toEqual(build().draft.stats)
  })

  it('places checkpoints and sizes the exam on a longer path', () => {
    const many = ids.flatMap((id) => [`${id}1`, `${id}2`, `${id}3`])
    const bigGraph = {
      nodes: many.map((id, index) => nodeAt(id, `c${index}`)),
      edges: [],
    }
    const modules = Array.from({ length: 5 }, (_, m) =>
      moduleSpec(
        `M${m}`,
        Array.from({ length: 3 }, (_, l) => {
          const start = (m * 3 + l) * 2
          return lesson(`L${m}.${l}`, many.slice(start, start + 2))
        }),
      ),
    )
    const validated = validateSynthesis(bigGraph, outline([section('S', modules)]), wide)
    const { draft } = sequencePath(validated, config, { seed: 's', now })
    const built = draft.sections[0]?.modules ?? []
    expect(built.map((module) => module.checkpoint?.id ?? null)).toEqual([
      null,
      null,
      null,
      'C01',
      null,
    ])
    expect(built[3]?.checkpoint?.module_ids).toEqual(['M01', 'M02', 'M03', 'M04'])
    expect(built[3]?.estimated_minutes).toBe(
      (built[3]?.lessons.reduce((sum, entry) => sum + entry.estimated_minutes, 0) ?? 0) +
        (built[3]?.reinforcement.estimated_minutes ?? 0) +
        (built[3]?.checkpoint?.estimated_minutes ?? 0),
    )
    expect(draft.stats.checkpoints).toBe(1)
    expect(draft.final_exam.blueprint.item_count).toBe(20)
  })
})

describe('helpers', () => {
  it('puts the primary source first and merges limit overrides over the defaults', () => {
    expect(orderedSources(config)).toEqual([PRIMARY, SECONDARY])
    expect(resolveSequencingLimits(undefined)).toEqual(DEFAULT_SEQUENCING_LIMITS)
    expect(
      resolveSequencingLimits({ lessonMinutes: { min: 1, max: 2, default: 1 } }),
    ).toMatchObject({
      lessonMinutes: { min: 1, max: 2, default: 1 },
      warmup: DEFAULT_SEQUENCING_LIMITS.warmup,
    })
  })
})
