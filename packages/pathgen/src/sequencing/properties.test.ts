import { mulberry32 } from '@retenia/core'
import { describe, expect, it } from 'vitest'
import { PRIMARY, SECONDARY } from '../testing/graph-fixtures'
import {
  flattenLessons,
  homeIndexOf,
  isAcyclic,
  reachable,
  violatedEdges,
} from '../testing/invariants'
import { type RandomCase, randomCase, shuffledCase } from '../testing/random'
import { DEFAULT_IMPORTANCE_THRESHOLD } from '../validate/types'
import { validateSynthesis } from '../validate/validate'
import { sequencePath } from './sequence'
import { DEFAULT_SEQUENCING_LIMITS, type SequencingConfig } from './types'

/**
 * Property tests over 1,000 randomly generated graphs and outlines, in the shape of
 * `packages/core/src/sessions/properties.test.ts`: the rules are restated here from
 * `docs/spec/04-path-generation.md` §3 stage 5 and §4, independently of the code, and every
 * case is run through validation and sequencing as one pipeline.
 */

const CASES = 1000
const random = mulberry32(0x8a1)
const now = new Date('2026-09-09T00:00:00Z')
const config: SequencingConfig = {
  primarySourceId: PRIMARY,
  sourceIds: [PRIMARY, SECONDARY],
  paceHoursPerWeek: 3,
  forExam: null,
}
const limits = DEFAULT_SEQUENCING_LIMITS

/**
 * Warnings that describe a state rather than a repair, and so are raised again by every pass
 * over the same input: the model's notes, a concept no chunk supports, a lesson that has one
 * concept and no neighbour to take one from.
 */
const PERSISTENT = new Set(['model_warning', 'concept_without_sources', 'lesson_too_small'])

function run(entry: RandomCase, seed = 'seed') {
  const validated = validateSynthesis(entry.graph, entry.outline, entry.ctx)
  if (validated.fatal !== null) return { validated, result: null }
  return { validated, result: sequencePath(validated, config, { seed, now }) }
}

const cases = Array.from({ length: CASES }, () => randomCase(random))
const runs = cases.map((entry) => ({ entry, ...run(entry) }))
const sequenced = runs.flatMap(({ entry, validated, result }) =>
  result === null ? [] : [{ entry, validated, result }],
)

// A thousand cases sequenced twice takes ~20 s on a CI runner: well over the 15 s default.
describe('validation and sequencing, over random inputs', { timeout: 120_000 }, () => {
  it('never throws, and is fatal only when nothing survives', () => {
    expect(sequenced.length).toBeGreaterThan(CASES / 2)
    for (const { validated, result } of runs) {
      if (result === null) {
        expect(validated.fatal?.code).toBe('outline_empty')
        expect(validated.outline.sections).toEqual([])
      }
    }
  })

  it('(a) honours every surviving prerequisite edge in the lesson order', () => {
    for (const { result } of sequenced) {
      const homes = homeIndexOf(flattenLessons(result.draft))
      expect(violatedEdges(result.graph.edges, homes)).toEqual([])
    }
  })

  it('(a′) drops exactly the concept edges the cycle warnings account for, and nothing else', () => {
    for (const { validated, result } of sequenced) {
      const before = validated.graph.edges.filter((edge) => edge.kind === 'PREREQ_OF').length
      const after = result.graph.edges.filter((edge) => edge.kind === 'PREREQ_OF').length
      const accounted = result.draft.warnings
        .filter((entry) => entry.code.endsWith('_cycle_broken'))
        .reduce((sum, entry) => sum + Number(entry.params.edges), 0)
      expect(before - after).toBe(accounted)
      expect(result.graph.edges.filter((edge) => edge.kind !== 'PREREQ_OF')).toEqual(
        validated.graph.edges.filter((edge) => edge.kind !== 'PREREQ_OF'),
      )
    }
  })

  it('(b) is byte-identical across runs and across the order the graph was listed in', () => {
    for (const [index, { entry, validated, result }] of runs.entries()) {
      const first = JSON.stringify({ validated, result })
      expect(JSON.stringify(run(entry))).toBe(first)
      expect(JSON.stringify(run(shuffledCase(entry, index)))).toBe(first)
    }
  })

  it('(c) warms up at most one concept per lesson, taught two lessons earlier and not lately', () => {
    for (const { result } of sequenced) {
      const lessons = flattenLessons(result.draft)
      const homes = homeIndexOf(lessons)
      const lastWarmed = new Map<string, number>()
      for (const [index, lesson] of lessons.entries()) {
        expect(lesson.warmup_concept_ids.length).toBeLessThanOrEqual(1)
        for (const id of lesson.warmup_concept_ids) {
          expect(homes.get(id) as number).toBeLessThanOrEqual(index - limits.warmup.minDistance)
          const last = lastWarmed.get(id)
          if (last !== undefined) expect(index - last).toBeGreaterThan(limits.warmup.cooldown)
          lastWarmed.set(id, index)
        }
      }
    }
  })

  it('(d) gives every module 3–7 lessons unless the whole path is too small', () => {
    for (const { result } of sequenced) {
      const tooSmall = result.draft.warnings.some((entry) => entry.code === 'path_too_small')
      const lessons = flattenLessons(result.draft)
      if (tooSmall) {
        expect(lessons.length).toBeLessThan(limits.lessonsPerModule.min)
        continue
      }
      for (const section of result.draft.sections) {
        for (const module of section.modules) {
          expect(module.lessons.length).toBeGreaterThanOrEqual(limits.lessonsPerModule.min)
          expect(module.lessons.length).toBeLessThanOrEqual(limits.lessonsPerModule.max)
        }
      }
    }
  })

  it('(e) keeps every lesson within 2–5 concepts and 1–3 objectives, or says why not', () => {
    for (const { validated, result } of sequenced) {
      const small = new Set(
        validated.warnings
          .filter((entry) => entry.code === 'lesson_too_small')
          .map((entry) => entry.params.lesson),
      )
      for (const lesson of flattenLessons(result.draft)) {
        expect(lesson.concept_ids.length).toBeLessThanOrEqual(5)
        expect(lesson.concept_ids.length).toBeGreaterThanOrEqual(1)
        if (lesson.concept_ids.length < 2) expect(small.has(lesson.title)).toBe(true)
        expect(lesson.objectives.length).toBeGreaterThanOrEqual(1)
        expect(lesson.objectives.length).toBeLessThanOrEqual(3)
        expect(lesson.estimated_minutes).toBeGreaterThanOrEqual(limits.lessonMinutes.min)
        expect(lesson.estimated_minutes).toBeLessThanOrEqual(limits.lessonMinutes.max)
      }
    }
  })

  it('(f) places checkpoints every 3–4 modules, none under 3, and a short tail goes without', () => {
    for (const { result } of sequenced) {
      const modules = result.draft.sections.flatMap((section) => section.modules)
      const positions = modules
        .map((module, index) => (module.checkpoint === null ? -1 : index))
        .filter((index) => index >= 0)
      if (modules.length < limits.checkpoint.spanMin) {
        expect(positions).toEqual([])
        continue
      }
      // The tail after the last checkpoint is empty, or too short for one.
      const tail = modules.length - 1 - (positions[positions.length - 1] as number)
      expect(tail === 0 || tail < limits.checkpoint.spanMin).toBe(true)
      let start = 0
      for (const position of positions) {
        const span = position - start + 1
        expect(span).toBeGreaterThanOrEqual(limits.checkpoint.spanMin)
        expect(span).toBeLessThanOrEqual(limits.checkpoint.spanMax)
        expect(modules[position]?.checkpoint?.module_ids).toEqual(
          modules.slice(start, position + 1).map((module) => module.id),
        )
        start = position + 1
      }
    }
  })

  it('(f′) interleaves every reinforcement after the first: an earlier concept within the first items', () => {
    for (const { result } of sequenced) {
      const modules = result.draft.sections.flatMap((section) => section.modules)
      for (const module of modules) {
        const earlier = new Set(module.reinforcement.earlier_concept_ids)
        if (earlier.size === 0) continue
        const drawn = module.reinforcement.concept_ids.slice(0, module.reinforcement.item_count)
        expect(drawn.some((id) => earlier.has(id))).toBe(true)
      }
    }
  })

  it('(g) weighs the final exam over every module, summing to exactly one', () => {
    for (const { result } of sequenced) {
      const modules = result.draft.sections.flatMap((section) => section.modules)
      const topics = result.draft.final_exam.blueprint.topics
      expect(topics.map((topic) => topic.module_id)).toEqual(modules.map((module) => module.id))
      expect(topics.reduce((sum, topic) => sum + Math.round(topic.weight * 100), 0)).toBe(100)
    }
  })

  it('(h) leaves the prerequisite graph acyclic, and breaks only edges that were on a cycle', () => {
    for (const { validated, result } of runs) {
      expect(isAcyclic(validated.graph.edges)).toBe(true)
      if (result !== null) expect(isAcyclic(result.graph.edges)).toBe(true)
      const kept = validated.graph.edges.filter((edge) => edge.kind === 'PREREQ_OF')
      const removed = validated.warnings
        .filter((entry) => entry.code === 'cycle_broken')
        .map((entry) => ({
          from: String(entry.params.from),
          to: String(entry.params.to),
          kind: 'PREREQ_OF' as const,
          confidence: Number(entry.params.confidence),
        }))
      // In removal order: when an edge went, the graph still held every edge removed after
      // it, and the edge closed a cycle there — a path led from its head back to its tail.
      for (const [index, edge] of removed.entries()) {
        expect(reachable([...kept, ...removed.slice(index + 1)], edge.to, edge.from)).toBe(true)
      }
    }
  })

  it('(i) numbers ids uniquely and in order, and only ever points prerequisites backwards', () => {
    for (const { result } of sequenced) {
      const lessons = flattenLessons(result.draft)
      expect(lessons.map((lesson) => lesson.id)).toEqual(
        lessons.map((_, index) => `L${String(index + 1).padStart(2, '0')}`),
      )
      const modules = result.draft.sections.flatMap((section) => section.modules)
      expect(modules.map((module) => module.id)).toEqual(
        modules.map((_, index) => `M${String(index + 1).padStart(2, '0')}`),
      )
      expect(result.draft.sections.map((section) => section.id)).toEqual(
        result.draft.sections.map((_, index) => `S${String(index + 1).padStart(2, '0')}`),
      )
      for (const [index, lesson] of lessons.entries()) {
        for (const prerequisite of lesson.prerequisite_lesson_ids) {
          expect(lessons.findIndex((other) => other.id === prerequisite)).toBeLessThan(index)
        }
      }
      for (const module of modules) expect(module.reinforcement.id).toBe(`${module.id}.reinf`)
    }
  })

  it('(j) homes every important concept exactly once and no concept twice, idempotently', () => {
    for (const { entry, validated, result } of sequenced) {
      const seen = new Map<string, number>()
      for (const lesson of flattenLessons(result.draft)) {
        for (const id of lesson.concept_ids) seen.set(id, (seen.get(id) ?? 0) + 1)
      }
      for (const node of validated.graph.nodes) {
        const count = seen.get(node.concept_id) ?? 0
        expect(count).toBeLessThanOrEqual(1)
        if (node.importance >= DEFAULT_IMPORTANCE_THRESHOLD) expect(count).toBe(1)
      }
      const again = validateSynthesis(validated.graph, validated.outline, entry.ctx)
      expect(again.graph).toEqual(validated.graph)
      expect(again.outline).toEqual(validated.outline)
      expect(again.warnings.filter((entry) => !PERSISTENT.has(entry.code))).toEqual([])
    }
  })
})
