import type { Chunk, Lesson, PathTree } from '@retenia/core'
import type { GenerationConfig } from '../config/generation-config'
import type { CoreLessonNode, PathDraft } from '../schemas/path-draft'
import type { ConceptKind } from '../validate/types'
import type { GlossaryTerm, PreviousLesson } from './context'
import { type LessonExpansion, readExpansion } from './expansion'

/**
 * One lesson as expansion sees it: the frozen row, the draft node sequencing produced, the
 * concepts it teaches, the misconceptions its material invites, and the ledger of what has
 * already landed.
 *
 * The row and the node are both needed and neither is redundant. The **row** is where the
 * writes go and what carries `status`; the **node** is what the model reads, and it lives in
 * `path_versions.spec` rather than in columns because §8's `LessonSpec` is a document. They
 * are joined on `spec_id`, which `freezePath` copies across and which survives a freeze.
 */

export interface ConceptFacts {
  readonly id: string
  readonly name: string
  readonly definition: string
  readonly kind: ConceptKind
}

export interface LessonPlan {
  readonly lessonId: string
  readonly specId: string
  readonly moduleId: string
  readonly node: CoreLessonNode
  readonly row: Lesson
  readonly concepts: readonly ConceptFacts[]
  readonly misconceptions: readonly {
    id: string
    conceptId: string
    text: string
    whyWrong: string
  }[]
  readonly previous: readonly PreviousLesson[]
  readonly expansion: LessonExpansion
}

/** The glossary the prompt sees: the lesson's own concepts, canonical name and definition. */
export function glossaryOf(plan: LessonPlan): readonly GlossaryTerm[] {
  return plan.concepts.map((concept) => ({
    conceptId: concept.id,
    name: concept.name,
    definition: concept.definition,
  }))
}

/** Every chunk the lesson's `source_refs` name, so the caller can load them in one read. */
export function mappedChunkIds(plans: readonly LessonPlan[]): readonly string[] {
  return [...new Set(plans.flatMap((plan) => plan.node.source_refs.map((ref) => ref.chunk_id)))]
}

/** The retrieval query for one lesson: what it is about, in the words the sources used. */
export function retrievalQuery(plan: LessonPlan): string {
  return [plan.node.title, ...plan.concepts.map((concept) => concept.name)].join(' — ')
}

export interface PlanInput {
  readonly tree: PathTree
  readonly draft: PathDraft
  readonly concepts: ReadonlyMap<string, ConceptFacts>
  readonly runId: string
}

/**
 * The core lessons of a frozen version, in path order, joined to their draft nodes.
 *
 * Only `kind: 'core'`. `freezePath` also materialises a `reinforcement` row per module and a
 * `checkpoint` row every few modules, and those are **assessment nodes**: they compose items
 * that already exist rather than writing theory, which is sub-phase 8.5's item bank and 9.3's
 * reinforcement flow. Expanding them here would write a lesson nobody asked for.
 */
export function planLessons(input: PlanInput): readonly LessonPlan[] {
  const nodes = new Map<string, CoreLessonNode>()
  for (const section of input.draft.sections) {
    for (const module of section.modules) {
      for (const lesson of module.lessons) nodes.set(lesson.id, lesson)
    }
  }

  const misconceptionsByConcept = new Map<
    string,
    { id: string; conceptId: string; text: string; whyWrong: string }[]
  >()
  for (const misconception of input.draft.misconceptions) {
    const list = misconceptionsByConcept.get(misconception.concept_id) ?? []
    list.push({
      id: misconception.id,
      conceptId: misconception.concept_id,
      text: misconception.text,
      whyWrong: misconception.why_wrong,
    })
    misconceptionsByConcept.set(misconception.concept_id, list)
  }

  const plans: LessonPlan[] = []
  for (const section of input.tree.sections) {
    for (const module of section.modules) {
      const previous: PreviousLesson[] = []
      for (const row of module.lessons) {
        if (row.kind !== 'core') continue
        const node = nodes.get(row.specId)
        if (node === undefined) continue

        const concepts = node.concept_ids.flatMap((id) => {
          const concept = input.concepts.get(id)
          return concept === undefined ? [] : [concept]
        })

        plans.push({
          lessonId: row.id,
          specId: row.specId,
          moduleId: module.id,
          node,
          row,
          concepts,
          misconceptions: node.concept_ids.flatMap((id) => misconceptionsByConcept.get(id) ?? []),
          previous: [...previous],
          expansion: readExpansion(row.expansion, input.runId),
        })

        previous.push({
          specId: row.specId,
          title: node.title,
          objective: node.objectives[0]?.text ?? null,
        })
      }
    }
  }
  return plans
}

/** A lesson is finished when P3, P4 and P5 have all landed. */
export function isExpanded(plan: LessonPlan): boolean {
  return plan.row.status === 'ready'
}

/** The path's importance floor: §11 rule 3's *"a path 'for an exam' inherits Urgente"*. */
export function importanceFloorOf(config: Pick<GenerationConfig, 'forExam'>): 'urgent' | null {
  return config.forExam === null ? null : 'urgent'
}

/** The chunks a lesson's mapped refs point at, from one bulk read. */
export function chunkIndex(chunks: readonly Chunk[]): ReadonlyMap<string, Chunk> {
  return new Map(chunks.map((chunk) => [chunk.id, chunk]))
}
