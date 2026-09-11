import type {
  JsonValue,
  KnowledgeItem,
  KnowledgeItemRepository,
  LessonKind,
  PathRepository,
} from '@retenia/core'

/**
 * "The progress migrates by `concept_id`, not by position" (`docs/spec/04-path-generation.md`
 * §7): what a regenerated version inherits from the one the learner was studying.
 *
 * - **Completion.** A v2 node is completed when every concept it teaches was taught by a v1 node
 *   of the same kind the learner completed — so a lesson whose concepts are all still covered
 *   stays completed wherever it moved, and one that gained a concept waits for the learner.
 * - **Cards keep their FSRS state.** Nothing here touches a card: a v1 item is re-pointed to the
 *   first v2 core lesson that teaches its concept and tagged `migrated`, so that lesson owns it
 *   and expansion does not write it again.
 * - **Orphans keep their cards.** An item whose concept no v2 lesson teaches stays where it was,
 *   tagged `sin lección` — still reviewed, no longer part of a lesson.
 *
 * The v1 rows themselves — lessons, their order, their ids — are never written.
 */

export const MIGRATED_TAG = 'migrated'
export const ORPHAN_TAG = 'sin lección'

export interface MigrationLesson {
  readonly id: string
  readonly kind: LessonKind
  readonly conceptIds: readonly string[]
  readonly completed: boolean
}

export type MigrationItem = Pick<KnowledgeItem, 'id' | 'lessonId' | 'topicId' | 'fields' | 'tags'>

export interface MigrationPlan {
  /** v2 nodes to mark completed. */
  readonly complete: readonly string[]
  /** v1 items that follow their concept into a v2 lesson. */
  readonly repoint: readonly { readonly itemId: string; readonly lessonId: string }[]
  /** v1 items whose concept no v2 lesson teaches. */
  readonly orphans: readonly string[]
}

/** The concept an item is about: its topic, else the first concept its fields name. */
export function conceptOfItem(item: Pick<KnowledgeItem, 'topicId' | 'fields'>): string | null {
  if (item.topicId !== null) return item.topicId
  const ids = (item.fields as { concept_ids?: unknown }).concept_ids
  return Array.isArray(ids) && typeof ids[0] === 'string' ? ids[0] : null
}

export function planProgressMigration(input: {
  readonly previous: readonly MigrationLesson[]
  /** In path order: the first core lesson teaching a concept is the one that owns its cards. */
  readonly next: readonly MigrationLesson[]
  readonly items: readonly MigrationItem[]
}): MigrationPlan {
  const learned = new Map<LessonKind, Set<string>>()
  for (const lesson of input.previous) {
    if (!lesson.completed) continue
    const set = learned.get(lesson.kind) ?? new Set<string>()
    for (const concept of lesson.conceptIds) set.add(concept)
    learned.set(lesson.kind, set)
  }

  const complete = input.next
    .filter((lesson) => {
      if (lesson.kind === 'remediation' || lesson.conceptIds.length === 0) return false
      const set = learned.get(lesson.kind)
      return set !== undefined && lesson.conceptIds.every((concept) => set.has(concept))
    })
    .map((lesson) => lesson.id)

  const owner = new Map<string, string>()
  for (const lesson of input.next) {
    if (lesson.kind !== 'core') continue
    for (const concept of lesson.conceptIds) if (!owner.has(concept)) owner.set(concept, lesson.id)
  }
  const repoint: { itemId: string; lessonId: string }[] = []
  const orphans: string[] = []
  for (const item of input.items) {
    const concept = conceptOfItem(item)
    const lessonId = concept === null ? undefined : owner.get(concept)
    if (lessonId === undefined) orphans.push(item.id)
    else repoint.push({ itemId: item.id, lessonId })
  }
  return { complete, repoint, orphans }
}

/**
 * Whether stage 7 still owes a lesson its flashcards (P5), given the items it already owns.
 *
 * A lesson with cards of its own was written: never again. A lesson that owns only cards a
 * regeneration carried over is done when they cover every concept it teaches, and still owed
 * P5 for a concept it gained — the dedupe then drops whatever repeats a migrated front.
 */
export function needsFlashcards(
  items: readonly Pick<KnowledgeItem, 'topicId' | 'fields' | 'tags'>[],
  lessonConceptIds: readonly string[],
): boolean {
  if (items.length === 0) return true
  const migrated = (item: Pick<KnowledgeItem, 'tags'>) =>
    Array.isArray(item.tags) && item.tags.includes(MIGRATED_TAG)
  if (items.some((item) => !migrated(item))) return false
  const covered = new Set(items.map(conceptOfItem))
  return lessonConceptIds.some((concept) => !covered.has(concept))
}

export interface MigrationRepos {
  readonly paths: Pick<PathRepository, 'updateLesson'>
  readonly knowledgeItems?: Pick<KnowledgeItemRepository, 'update'>
}

function withTag(
  tags: readonly JsonValue[],
  add: string | null,
  remove: string | null,
): JsonValue[] {
  const kept = tags.filter((tag) => tag !== remove && tag !== add)
  return add === null ? kept : [...kept, add]
}

export interface MigrationSummary {
  readonly completed: number
  readonly repointed: number
  readonly orphaned: number
}

export async function applyProgressMigration(
  repos: MigrationRepos,
  plan: MigrationPlan,
  items: readonly MigrationItem[],
  now: Date,
): Promise<MigrationSummary> {
  for (const lessonId of plan.complete) {
    await repos.paths.updateLesson(lessonId, { completedAt: now })
  }
  if (repos.knowledgeItems === undefined) {
    return { completed: plan.complete.length, repointed: 0, orphaned: 0 }
  }
  const byId = new Map(items.map((item) => [item.id, item]))
  for (const { itemId, lessonId } of plan.repoint) {
    const item = byId.get(itemId)
    await repos.knowledgeItems.update(itemId, {
      lessonId,
      tags: withTag(item?.tags ?? [], MIGRATED_TAG, ORPHAN_TAG),
    })
  }
  for (const itemId of plan.orphans) {
    const item = byId.get(itemId)
    await repos.knowledgeItems.update(itemId, { tags: withTag(item?.tags ?? [], ORPHAN_TAG, null) })
  }
  return {
    completed: plan.complete.length,
    repointed: plan.repoint.length,
    orphaned: plan.orphans.length,
  }
}
