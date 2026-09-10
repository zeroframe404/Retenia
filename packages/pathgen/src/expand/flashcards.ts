import type {
  Card,
  EmbeddingProvider,
  ImportanceLevel,
  JsonObject,
  KnowledgeItem,
  KnowledgeItemKind,
  NewEntity,
} from '@retenia/core'
import { CARD_STATE } from '@retenia/core'
import { normalizeTerm } from '../consolidate/normalize'
import { dot } from '../consolidate/vector'
import type { Flashcard } from '../schemas/flashcards'
import { type GenerationWarning, warning } from '../schemas/warnings'
import type { CitableFragment, LessonContext } from './context'

/**
 * P5's answers as rows: `knowledge_items` in "Need to Learn" plus one `cards` row each
 * (`docs/spec/02-memory-system.md` §11 step 1, `docs/spec/04-path-generation.md` §4 item 9).
 *
 * **"Need to Learn" is `knowledge_items.status`, not a null `due`.** `cards.due` is `NOT NULL`
 * and mirrors `ts-fsrs` 1:1, which the domain rules forbid reshaping; what actually keeps a
 * card out of the queue is `duePredicate`'s `knowledge_items.status = 'active'`
 * (`packages/db/src/repositories/cards.ts`). A `need_to_learn` item is invisible to the
 * scheduler however its `due` reads, and completing the lesson is what promotes it — which is
 * exactly §11's *"items (Need to Learn → New)"*.
 *
 * **Dedupe before writing, never after.** §1.2 rule 11 and §5's gate 5 both put the threshold
 * at cosine > 0.92; the exact pass on the normalized front runs first and needs no provider,
 * so a path generated with no embedding provider still refuses the obvious duplicates.
 */

/** §1.2's "dedupe by embeddings, cosine > 0.92 merges", and §5's gate 5. */
export const DUPLICATE_COSINE = 0.92

/** §4 item 9's "3–8 per lesson, maximum 12". The ceiling is the schema's; this is the floor,
 *  and it is a *reporting* threshold rather than a quota — §1.3 lists material that should
 *  not become a card at all, so a lesson made of it honestly yields fewer (§14 pitfall 4). */
export const MIN_FLASHCARDS_PER_LESSON = 3

export interface MemoryItemDraft {
  readonly item: Omit<NewEntity<KnowledgeItem>, 'lessonId'>
  readonly card: Omit<NewEntity<Card>, 'itemId'>
  /** The normalized front, so the caller can extend the path's index as it writes. */
  readonly key: string
}

export interface FlashcardPersistInput {
  readonly lessonSpecId: string
  readonly flashcards: readonly Flashcard[]
  readonly context: LessonContext
  /** The concept the lesson is mostly about, for `knowledge_items.topic_id`. */
  readonly primaryConceptId: string | null
  /** Every normalized front the path already has, with its vector when one was computed. */
  readonly existing: ReadonlyMap<string, Float32Array | null>
  /** The path level's floor: a path "for an exam" inherits `urgent` (§11 rule 3). */
  readonly importanceFloor: ImportanceLevel | null
  readonly now: Date
}

export interface FlashcardPersistResult {
  readonly drafts: readonly MemoryItemDraft[]
  readonly deduped: number
  readonly warnings: readonly GenerationWarning[]
}

/** What a card asks, as one string: the cloze sentence, or the front with its cue. */
export function frontOf(card: Flashcard): string {
  if (card.cloze_text !== null) return card.cloze_text
  const cue = card.context_cue === null ? '' : `${card.context_cue} `
  return `${cue}${card.front ?? ''}`
}

export function frontKey(card: Flashcard): string {
  return normalizeTerm(frontOf(card))
}

/** §8's `Flashcard.v1` type as the `cards.template` the renderer switches on. */
function templateOf(card: Flashcard): string {
  return card.type === 'cloze' ? 'cloze:c1' : card.type
}

/**
 * The item kind, from what the card is shaped like rather than from the concept it names: a
 * cloze over a definition is a `fact` to the scheduler whatever the concept's kind is.
 */
function kindOf(card: Flashcard): KnowledgeItemKind {
  if (card.type === 'contrast') return 'misconception'
  if (card.type === 'example_to_concept') return 'example'
  return card.cloze_text === null ? 'concept' : 'fact'
}

const IMPORTANCE_ORDER: readonly ImportanceLevel[] = Object.freeze([
  'paused',
  'maintenance',
  'normal',
  'high',
  'urgent',
])

/** The higher of the model's proposal and the path's floor. */
export function effectiveImportance(
  proposed: ImportanceLevel,
  floor: ImportanceLevel | null,
): ImportanceLevel {
  if (floor === null) return proposed
  return IMPORTANCE_ORDER.indexOf(floor) > IMPORTANCE_ORDER.indexOf(proposed) ? floor : proposed
}

function locatorOf(fragments: readonly CitableFragment[]): JsonObject | null {
  const first = fragments[0]
  if (first === undefined) return null
  return { label: first.locator, block_ids: [...first.blockIds], chunk_id: first.chunkId }
}

export function toMemoryItems(input: FlashcardPersistInput): FlashcardPersistResult {
  const byCiteId = new Map(input.context.citable.map((fragment) => [fragment.citeId, fragment]))
  const drafts: MemoryItemDraft[] = []
  const warnings: GenerationWarning[] = []
  const seen = new Set(input.existing.keys())
  let deduped = 0

  for (const card of input.flashcards) {
    const key = frontKey(card)
    if (key === '' || seen.has(key)) {
      deduped += 1
      warnings.push(
        warning('flashcard_deduped', { lesson: input.lessonSpecId, reason: 'exact', front: key }),
      )
      continue
    }
    seen.add(key)

    const fragments = card.citations
      .map((id) => byCiteId.get(id))
      .filter((fragment): fragment is CitableFragment => fragment !== undefined)

    // §1.2 rule 18: "each card stores `source_id` + a locator". A card whose cite ids resolve
    // to nothing stores neither, so "Reportar error" has nowhere to go and the QA gates of
    // 8.4 have nothing to check the claim against. Kept rather than dropped — the card may
    // still be a good one — but no longer silent.
    if (fragments.length === 0) {
      warnings.push(warning('flashcard_uncited', { lesson: input.lessonSpecId, front: key }))
    }

    drafts.push({
      key,
      item: {
        topicId: card.concept_ids[0] ?? input.primaryConceptId,
        kind: kindOf(card),
        fields: {
          type: card.type,
          front: card.front,
          back: card.back,
          cloze_text: card.cloze_text,
          context_cue: card.context_cue,
          interference_group: card.interference_group,
          concept_ids: [...card.concept_ids],
          citations: [...card.citations],
        },
        sourceId: fragments[0]?.sourceId ?? null,
        annotationId: null,
        locator: locatorOf(fragments),
        asOf: card.as_of,
        importance: effectiveImportance(card.importance, input.importanceFloor),
        // The column default, stated rather than relied on: this is the line §11 step 1 is
        // about, and a future default change must not silently schedule a whole path.
        status: 'need_to_learn',
        createdBy: 'ai',
        tags: [],
      },
      card: {
        template: templateOf(card),
        payload: null,
        // A real instant, because the column is NOT NULL and mirrors `ts-fsrs`. It is not a
        // schedule: `duePredicate` requires an `active` item, so nothing here is served until
        // the lesson is completed and the item is promoted.
        due: input.now,
        stability: 0,
        difficulty: 0,
        scheduledDays: 0,
        learningSteps: 0,
        reps: 0,
        lapses: 0,
        state: CARD_STATE.New,
        lastReview: null,
        suspended: false,
        buriedUntil: null,
        leech: false,
        importanceOverride: null,
        importanceOverrideExpiresAt: null,
        examId: null,
      },
    })
  }

  return { drafts, deduped, warnings }
}

export interface EmbeddingDedupeResult {
  readonly kept: readonly MemoryItemDraft[]
  readonly vectors: ReadonlyMap<string, Float32Array>
  readonly deduped: number
  readonly warnings: readonly GenerationWarning[]
}

/**
 * The second dedupe pass: cards whose fronts mean the same thing in different words.
 *
 * Runs only when an embedding provider is wired, and only over what the exact pass let
 * through — one call for the batch of new fronts, compared against the vectors the caller
 * already holds for the path. Without a provider it is skipped and the run says so once, the
 * way consolidation already reports `embeddings_unavailable`.
 */
export async function dedupeByEmbedding(
  drafts: readonly MemoryItemDraft[],
  existing: ReadonlyMap<string, Float32Array | null>,
  embeddings: Pick<EmbeddingProvider, 'embed'>,
  lessonSpecId: string,
  threshold = DUPLICATE_COSINE,
): Promise<EmbeddingDedupeResult> {
  if (drafts.length === 0) return { kept: [], vectors: new Map(), deduped: 0, warnings: [] }

  const fresh = await embeddings.embed(drafts.map((draft) => draft.key))
  const known = [...existing.entries()].flatMap(([key, vector]) =>
    vector === null ? [] : [[key, vector] as const],
  )
  const kept: MemoryItemDraft[] = []
  const vectors = new Map<string, Float32Array>()
  const warnings: GenerationWarning[] = []
  let deduped = 0

  for (const [index, draft] of drafts.entries()) {
    const vector = fresh[index]
    if (vector === undefined) {
      kept.push(draft)
      continue
    }
    const near =
      known.some(([, other]) => dot(vector, other) > threshold) ||
      [...vectors.values()].some((other) => dot(vector, other) > threshold)
    if (near) {
      deduped += 1
      warnings.push(
        warning('flashcard_deduped', {
          lesson: lessonSpecId,
          reason: 'cosine',
          front: draft.key,
        }),
      )
      continue
    }
    vectors.set(draft.key, vector)
    kept.push(draft)
  }

  return { kept, vectors, deduped, warnings }
}
