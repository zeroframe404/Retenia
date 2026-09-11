import type { AiClient, AiResultCache, ProviderRole, Timers } from '@retenia/ai'
import type {
  Activity,
  AttemptRepository,
  AuthoringConcept,
  AuthoringMisconception,
  Card,
  CardRepository,
  ChunkRepository,
  Clock,
  ItemBankRepository,
  JsonObject,
  KnowledgeItemRepository,
  Lesson,
  NewEntity,
  PathRepository,
  PathTree,
  PathVersion,
  Remediation,
  RemediationRefusal,
  RemediationRepository,
  ReviewLogRepository,
} from '@retenia/core'
import { CARD_STATE, retrievabilityNow } from '@retenia/core'
import type { CitableFragment } from '../expand/context'
import { activityStem } from '../item-bank/stems'
import { asJson } from '../json'
import type { PathgenLogger } from '../logger'
import type { PathgenPrompts } from '../prompts'
import { knowledgeGraphDocumentSchema } from '../schemas/knowledge-graph'
import { lessonCitationSchema } from '../schemas/lesson'
import { pathDraftSchema } from '../schemas/path-draft'
import type { RemediationAuthor } from './author'
import {
  EMPTY_BOOST,
  isOurOverride,
  onBoostedReview,
  planBoost,
  readBoost,
  writeBoost,
} from './boost'
import {
  assembleTheory,
  estimateMinutes,
  fragmentsFrom,
  pickBankItems,
  writeRemediation,
} from './generate'
import { remediationSpecId } from './ids'
import { checkLimits } from './limits'
import { measureOutcome } from './outcome'
import { type PlacementLesson, placeRemediation } from './placement'
import { DAY_MS, INSERTED_STATUSES, REMEDIATION_POLICY, type RemediationPolicy } from './policy'
import {
  confidentErrorTrigger,
  memoryTrigger,
  misconceptionTrigger,
  reinforcementTriggers,
  userRequestTrigger,
} from './triggers'
import type { Placement, RemediationCandidate, RemediationSignal } from './types'

/**
 * The remediation service (`docs/spec/04-path-generation.md` §11, sub-phase 8.6): domain events
 * in, decisions out.
 *
 * `handle` turns a signal into candidates (`triggers.ts`), places each one on the path
 * (`placement.ts`), asks the limits (`limits.ts`), and either logs the refusal or inserts the
 * detour: a `remediations` row and a `lessons` row of kind `remediation` with the derived id
 * `L07.r1`, written by P11, holding up to three item-bank `remediation` items (the rest
 * generated) and at most one contrast flashcard, and raising the concept's cards to `high`
 * for 14 days or two clean reviews. The base path is never touched: no core lesson is
 * renumbered, reordered or rewritten (`docs/spec/01-decisions.md` §3).
 *
 * Operations run one at a time. Every decision reads the log and then writes it, and two
 * interleaved triggers would both pass "1 active per module".
 */

export interface RemediationRepos {
  readonly paths: Pick<
    PathRepository,
    | 'findById'
    | 'findVersion'
    | 'findVersionByNumber'
    | 'loadTree'
    | 'findLesson'
    | 'findModule'
    | 'findSection'
    | 'createLesson'
    | 'updateLesson'
    | 'softDeleteLesson'
    | 'createActivities'
    | 'findActivities'
    | 'listActivitiesByConcepts'
  >
  readonly remediations: RemediationRepository
  readonly itemBank: Pick<ItemBankRepository, 'listByUsage' | 'bumpExposure'>
  readonly chunks: Pick<ChunkRepository, 'findMany'>
  readonly knowledgeItems: Pick<
    KnowledgeItemRepository,
    'findById' | 'listByTopic' | 'listByLesson' | 'create' | 'update'
  >
  readonly cards: Pick<CardRepository, 'findById' | 'listByItems' | 'overrideImportance' | 'create'>
  readonly reviewLogs: Pick<ReviewLogRepository, 'listSince'>
  readonly attempts: Pick<AttemptRepository, 'listSince'>
}

export interface RemediationUnitOfWork extends RemediationRepos {
  /** `UnitOfWork.transaction`: the work only awaits the repositories it is handed. */
  transaction<T>(work: (repos: RemediationRepos) => Promise<T>): Promise<T>
}

export type RemediationChangeKind = 'inserted' | 'updated' | 'removed' | 'refused' | 'failed'

export interface RemediationChange {
  readonly kind: RemediationChangeKind
  readonly remediation: Remediation
  readonly lesson: Lesson | null
}

export interface RemediationServiceDeps {
  readonly ai: Pick<AiClient, 'structured'>
  readonly resultCache?: Pick<AiResultCache, 'get'>
  readonly author: RemediationAuthor
  readonly prompts: Pick<PathgenPrompts, 'remediation'>
  readonly repos: RemediationUnitOfWork
  readonly clock: Clock
  readonly timers: Pick<Timers, 'sleep'>
  readonly logger: PathgenLogger
  /** The `pathgen.remediationTier` setting, read per detour. Absent means the prompt's role. */
  readonly tier?: () => Promise<ProviderRole>
  /** R of a card now — the memory service's, so the day boundary is the learner's. */
  readonly retrievability?: (card: Card, at: Date) => number
  /** A detour appeared, changed or went away: the path map redraws, the toast shows. */
  readonly onChange?: (change: RemediationChange) => void
  /** The third remediation of a concept: lower the module's mastery estimate (§11). */
  readonly onRevisitCore?: (input: {
    readonly pathVersionId: string
    readonly moduleId: string | null
    readonly conceptId: string
    readonly lessonId: string | null
  }) => Promise<void>
  readonly policy?: RemediationPolicy
}

export type RemediationDecision =
  | { readonly kind: 'inserted'; readonly remediation: Remediation; readonly lesson: Lesson }
  | {
      readonly kind: 'refused'
      readonly refusal: RemediationRefusal
      /** `null` when the same refusal was already the concept's last word and was not logged
       *  again — a trigger that keeps firing on a refused concept is one fact, not many. */
      readonly remediation: Remediation | null
      readonly revisitLessonId: string | null
    }
  | { readonly kind: 'failed'; readonly remediation: Remediation; readonly error: string }
  | { readonly kind: 'ignored'; readonly reason: string }

export interface RemediationService {
  handle(signal: RemediationSignal): Promise<RemediationDecision[]>
  list(pathVersionId: string): Promise<Remediation[]>
  /** The learner finished the detour: its lesson completes and its card joins the queue. */
  complete(remediationId: string): Promise<Remediation>
  /** The learner closed it: the node disappears from the map; its id is never reused. */
  dismiss(remediationId: string): Promise<Remediation>
  /** Daily: refresh the measured outcome of every recent detour. Returns how many changed. */
  sweep(now?: Date): Promise<number>
  /**
   * A regeneration was frozen: the superseded version's open detours can no longer be shown,
   * completed or dismissed, so they close (`dismissed`, `evidence.retired_by`). Their importance
   * raise stays — it is about the concept, which the new version still teaches. Returns how many.
   */
  retire(pathVersionId: string, supersededBy: string): Promise<number>
}

export class RemediationError extends Error {
  override readonly name = 'RemediationError'
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The lessons of a tree in path order: section, module, ordinal — and, within one ordinal, a
 * detour placed `before` its anchor ahead of it and one placed `after` behind it. A detour
 * shares its anchor's ordinal (nothing is renumbered), so the stored order alone would put
 * every detour after its anchor.
 */
export function lessonsInOrder(tree: PathTree): Lesson[] {
  const rank = (lesson: Lesson): number => {
    if (lesson.kind !== 'remediation') return 1
    return lesson.remediation?.position === 'before' ? 0 : 2
  }
  return tree.sections.flatMap((section) =>
    section.modules.flatMap((module) =>
      module.lessons
        .map((lesson, index) => ({ lesson, index }))
        .sort(
          (a, b) =>
            a.lesson.ordinal - b.lesson.ordinal ||
            rank(a.lesson) - rank(b.lesson) ||
            a.index - b.index,
        )
        .map(({ lesson }) => lesson),
    ),
  )
}

function toPlacementLesson(lesson: Lesson): PlacementLesson {
  return {
    id: lesson.id,
    specId: lesson.specId,
    moduleId: lesson.moduleId,
    kind: lesson.kind,
    parentLessonId: lesson.parentLessonId,
    conceptIds: lesson.conceptIds,
    prerequisiteLessonIds: lesson.prerequisiteLessonIds,
    completed: lesson.completedAt !== null,
  }
}

/** The misconception a failed attempt recorded, as the host stamps it on `feedback`/`answer`. */
function misconceptionOfAttempt(attempt: { feedback: unknown; answer: unknown }): string | null {
  for (const value of [attempt.feedback, attempt.answer]) {
    if (isRecord(value) && typeof value.misconception_id === 'string') return value.misconception_id
  }
  return null
}

function newCard(itemId: string, now: Date): NewEntity<Card> {
  return {
    itemId,
    template: 'contrast',
    payload: null,
    // A real instant because the column is NOT NULL; the item is `need_to_learn`, so nothing is
    // served until the detour is completed and the item promoted (`toMemoryItems` does the same).
    due: now,
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
  }
}

export function createRemediationService(deps: RemediationServiceDeps): RemediationService {
  const policy = deps.policy ?? REMEDIATION_POLICY
  const { repos, clock } = deps
  const emit = (change: RemediationChange): void => {
    try {
      deps.onChange?.(change)
    } catch (error) {
      deps.logger.error('[pathgen] a remediation listener threw', error)
    }
  }

  // --- reading the path -------------------------------------------------------------------

  const versionOfLesson = async (
    lessonId: string,
  ): Promise<{ lesson: Lesson; version: PathVersion } | null> => {
    const lesson = await repos.paths.findLesson(lessonId)
    if (lesson === undefined) return null
    const module = await repos.paths.findModule(lesson.moduleId)
    const section =
      module === undefined ? undefined : await repos.paths.findSection(module.sectionId)
    const version =
      section === undefined ? undefined : await repos.paths.findVersion(section.pathVersionId)
    return version === undefined ? null : { lesson, version }
  }

  /** Frozen and the version the learner is studying: a detour on an old version helps nobody. */
  const isLive = async (version: PathVersion): Promise<boolean> => {
    if (version.frozenAt === null) return false
    const path = await repos.paths.findById(version.pathId)
    return path !== undefined && path.activeVersion === version.number
  }

  const conceptOf = (version: PathVersion, conceptId: string): AuthoringConcept => {
    const graph = knowledgeGraphDocumentSchema.safeParse(version.knowledgeGraph)
    const node = graph.success
      ? graph.data.nodes.find((candidate) => candidate.concept_id === conceptId)
      : undefined
    return {
      id: conceptId,
      name: node?.canonical ?? conceptId,
      definition: node?.definition ?? '',
    }
  }

  const misconceptionOf = (
    version: PathVersion,
    misconceptionId: string | null,
  ): AuthoringMisconception | null => {
    if (misconceptionId === null) return null
    const draft = pathDraftSchema.safeParse(version.spec)
    const found = draft.success
      ? draft.data.misconceptions.find((entry) => entry.id === misconceptionId)
      : undefined
    return found === undefined
      ? null
      : { id: found.id, conceptId: found.concept_id, text: found.text, whyWrong: found.why_wrong }
  }

  /** The fragments P11 may cite: what the teaching lesson cited, then what the outline mapped
   *  to it, then the concept's own source refs. */
  const fragmentsFor = async (
    version: PathVersion,
    conceptId: string,
    teaching: Lesson | undefined,
  ): Promise<CitableFragment[]> => {
    const ids: string[] = []
    for (const raw of teaching?.citations ?? []) {
      const citation = lessonCitationSchema.safeParse(raw)
      if (citation.success) ids.push(citation.data.chunk_id)
    }
    const draft = pathDraftSchema.safeParse(version.spec)
    if (draft.success && teaching !== undefined) {
      for (const section of draft.data.sections) {
        for (const module of section.modules) {
          for (const lesson of module.lessons) {
            if (lesson.id === teaching.specId)
              ids.push(...lesson.source_refs.map((ref) => ref.chunk_id))
          }
        }
      }
    }
    const graph = knowledgeGraphDocumentSchema.safeParse(version.knowledgeGraph)
    if (graph.success) {
      const node = graph.data.nodes.find((candidate) => candidate.concept_id === conceptId)
      ids.push(...(node?.source_refs ?? []).map((ref) => ref.chunk_id))
    }
    const unique = [...new Set(ids)]
    if (unique.length === 0) return []
    const chunks = await repos.chunks.findMany(unique)
    const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]))
    return fragmentsFrom(unique.flatMap((id) => byId.get(id) ?? []))
  }

  // --- deciding ---------------------------------------------------------------------------

  const logRefusal = async (
    candidate: RemediationCandidate,
    refusal: RemediationRefusal,
    placement: Placement | null,
    history: readonly Remediation[],
  ): Promise<Remediation | null> => {
    const last = [...history].reverse().find((row) => row.conceptId === candidate.conceptId)
    // The concept's detour is open (the dedupe), or the concept was already refused for the
    // same reason by the same kind of trigger: nothing new to record.
    if (
      last !== undefined &&
      (last.status === 'active' ||
        (last.status === 'refused' &&
          last.refusal === refusal &&
          last.trigger === candidate.trigger))
    ) {
      return null
    }
    const now = clock.now()
    return repos.remediations.create({
      pathVersionId: candidate.pathVersionId,
      moduleId: placement?.moduleId ?? null,
      conceptId: candidate.conceptId,
      misconceptionId: candidate.misconceptionId,
      trigger: candidate.trigger,
      status: 'refused',
      refusal,
      anchorLessonId: placement?.anchorLessonId ?? null,
      lessonId: null,
      specId: null,
      // A refusal that sends the learner back names where to: the lesson that teaches it.
      evidence:
        refusal === 'revisit_core'
          ? { ...candidate.evidence, revisit_lesson_id: placement?.teachingLessonId ?? null }
          : candidate.evidence,
      boost: {},
      outcome: null,
      resolvedAt: now,
    })
  }

  const consider = async (candidate: RemediationCandidate): Promise<RemediationDecision> => {
    const version = await repos.paths.findVersion(candidate.pathVersionId)
    if (version === undefined) return { kind: 'ignored', reason: 'version_not_found' }
    if (!(await isLive(version))) return { kind: 'ignored', reason: 'version_not_active' }
    const tree = await repos.paths.loadTree(version.id)
    if (tree === undefined) return { kind: 'ignored', reason: 'version_not_found' }
    const lessons = lessonsInOrder(tree)
    const history = await repos.remediations.listByPathVersion(version.id)

    // A confident error the diagnostic already turned into a decision is not decided twice.
    const sessionId = candidate.evidence.session_id
    const itemId = candidate.evidence.item_id
    if (
      typeof sessionId === 'string' &&
      history.some(
        (row) => row.evidence.session_id === sessionId && row.evidence.item_id === itemId,
      )
    ) {
      return { kind: 'ignored', reason: 'already_decided' }
    }

    const placement = placeRemediation({
      lessons: lessons.map(toPlacementLesson),
      conceptId: candidate.conceptId,
      lessonId: candidate.lessonId,
    })
    const now = clock.now()
    if (placement === null) {
      const remediation = await logRefusal(candidate, 'no_anchor', null, history)
      if (remediation !== null) emit({ kind: 'refused', remediation, lesson: null })
      return { kind: 'refused', refusal: 'no_anchor', remediation, revisitLessonId: null }
    }

    const recent = await repos.remediations.listSince(new Date(now.getTime() - policy.weekMs))
    const verdict = checkLimits(
      {
        conceptId: candidate.conceptId,
        moduleId: placement.moduleId,
        version: history,
        recent,
        now,
        teachingLessonId: placement.teachingLessonId,
      },
      policy,
    )
    if (verdict.kind === 'refuse') {
      const remediation = await logRefusal(candidate, verdict.refusal, placement, history)
      const revisitLessonId = verdict.revisitLessonId ?? null
      if (remediation !== null) {
        emit({ kind: 'refused', remediation, lesson: null })
        if (verdict.refusal === 'revisit_core' && deps.onRevisitCore !== undefined) {
          await deps
            .onRevisitCore({
              pathVersionId: version.id,
              moduleId: placement.moduleId,
              conceptId: candidate.conceptId,
              lessonId: revisitLessonId,
            })
            .catch((error: unknown) =>
              deps.logger.error('[pathgen] lowering the module’s mastery failed', error),
            )
        }
      }
      return { kind: 'refused', refusal: verdict.refusal, remediation, revisitLessonId }
    }

    const anchor = lessons.find((lesson) => lesson.id === placement.anchorLessonId) as Lesson
    const taken = [
      ...history.flatMap((row) => (row.specId === null ? [] : [row.specId])),
      ...lessons.filter((lesson) => lesson.kind === 'remediation').map((lesson) => lesson.specId),
    ]
    const specId = remediationSpecId(anchor.specId, taken)
    const concept = conceptOf(version, candidate.conceptId)

    const inserted = await repos.transaction(async (tx) => {
      const row = await tx.remediations.create({
        pathVersionId: version.id,
        moduleId: placement.moduleId,
        conceptId: candidate.conceptId,
        misconceptionId: candidate.misconceptionId,
        trigger: candidate.trigger,
        status: 'active',
        refusal: null,
        anchorLessonId: anchor.id,
        lessonId: null,
        specId,
        evidence: candidate.evidence,
        boost: {},
        outcome: null,
        resolvedAt: null,
      })
      const lesson = await tx.paths.createLesson({
        moduleId: anchor.moduleId,
        // The anchor's own position: nothing after it moves. The map orders a detour beside
        // its anchor by `remediation.position`.
        ordinal: anchor.ordinal,
        specId,
        kind: 'remediation',
        parentLessonId: anchor.id,
        title: concept.name,
        status: 'generating',
        objectives: [],
        conceptIds: [candidate.conceptId],
        prerequisiteLessonIds: [anchor.specId],
        estimatedMinutes: null,
        theory: null,
        citations: [],
        qa: null,
        expansion: null,
        remediation: {
          remediation_id: row.id,
          trigger: candidate.trigger,
          // `Lesson.v1`'s `anchor_concept_id` (sub-phase 8.6): the idea the detour is about.
          anchor_concept_id: candidate.conceptId,
          concept_id: candidate.conceptId,
          misconception_id: candidate.misconceptionId,
          position: placement.position,
          anchor_spec_id: anchor.specId,
          evidence: candidate.evidence,
        },
        unlockRule: null,
        xpReward: 0,
        completedAt: null,
      })
      const linked = await tx.remediations.update(row.id, { lessonId: lesson.id })
      return { remediation: linked, lesson }
    })
    emit({ kind: 'inserted', remediation: inserted.remediation, lesson: inserted.lesson })

    try {
      const written = await writeDetour(version, tree, lessons, candidate, placement, inserted)
      emit({ kind: 'updated', remediation: written.remediation, lesson: written.lesson })
      return { kind: 'inserted', remediation: written.remediation, lesson: written.lesson }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      deps.logger.error(`[pathgen] the remediation ${specId} could not be written`, error)
      const failed = await repos.transaction(async (tx) => {
        await tx.paths.updateLesson(inserted.lesson.id, { status: 'failed' })
        await tx.paths.softDeleteLesson(inserted.lesson.id)
        return tx.remediations.update(inserted.remediation.id, {
          status: 'failed',
          resolvedAt: clock.now(),
          evidence: { ...candidate.evidence, error: message.slice(0, 300) },
        })
      })
      emit({ kind: 'failed', remediation: failed, lesson: null })
      return { kind: 'failed', remediation: failed, error: message }
    }
  }

  /** P11 and everything it writes: the theory, the items, the contrast card, the raise. */
  const writeDetour = async (
    version: PathVersion,
    tree: PathTree,
    lessons: readonly (Lesson & { activities?: Activity[] })[],
    candidate: RemediationCandidate,
    placement: Placement,
    inserted: { remediation: Remediation; lesson: Lesson },
  ): Promise<{ remediation: Remediation; lesson: Lesson }> => {
    const now = clock.now()
    const teaching =
      placement.teachingLessonId === null
        ? undefined
        : lessons.find((lesson) => lesson.id === placement.teachingLessonId)
    const anchor = lessons.find((lesson) => lesson.id === placement.anchorLessonId) as Lesson & {
      activities?: Activity[]
    }
    const fragments = await fragmentsFor(version, candidate.conceptId, teaching)

    const exclude = new Set<string>(
      [candidate.evidence.item_id, candidate.evidence.activity_id].filter(
        (id): id is string => typeof id === 'string',
      ),
    )
    const bank = pickBankItems(
      await repos.itemBank.listByUsage(version.id, 'remediation'),
      candidate.conceptId,
      exclude,
      policy.items,
    )
    const bankActivities = await repos.paths.findActivities(bank.map((entry) => entry.activityId))
    const bankById = new Map(bankActivities.map((activity) => [activity.id, activity]))
    const reused = bank.flatMap((entry) => bankById.get(entry.activityId) ?? [])

    const concept = conceptOf(version, candidate.conceptId)
    const misconception = misconceptionOf(version, candidate.misconceptionId)
    const role = deps.tier === undefined ? deps.prompts.remediation.role : await deps.tier()
    const collected = await writeRemediation(
      { ...deps, prompt: deps.prompts.remediation },
      {
        pathVersionId: version.id,
        specId: inserted.lesson.specId,
        lang: tree.path.language,
        anchorTitle: anchor.title,
        concept,
        misconception,
        errors: candidate.errors,
        excerpts: fragments.map((fragment) => ({
          citeId: fragment.citeId,
          text: fragment.text,
          locator: fragment.locator,
        })),
        itemsWanted: Math.max(0, policy.items - reused.length),
        avoid: [...reused, ...(anchor.activities ?? [])].map((activity) => activityStem(activity)),
      },
      role,
    )
    const assembled = assembleTheory(
      collected,
      fragments,
      inserted.lesson.specId,
      candidate.misconceptionId,
    )
    const itemCount = reused.length + collected.items.length
    const card = collected.contrastCard
    const cardFragments =
      card === null ? [] : fragments.filter((fragment) => card.citations.includes(fragment.citeId))

    // The raise is planned from reads made before the transaction (`UnitOfWork`'s rule).
    const items = await repos.knowledgeItems.listByTopic(candidate.conceptId)
    const cards = await repos.cards.listByItems(items.map((item) => item.id))
    const boost = planBoost(
      cards,
      new Map(items.map((item) => [item.id, item.importance])),
      now,
      policy,
    )

    return repos.transaction(async (tx) => {
      const activityRows: NewEntity<Activity>[] = [
        ...reused.map((activity, index) => ({
          lessonId: inserted.lesson.id,
          ordinal: index,
          type: activity.type,
          family: activity.family,
          schemaVersion: activity.schemaVersion,
          lang: activity.lang,
          bloom: activity.bloom,
          difficulty: activity.difficulty,
          conceptIds: [...activity.conceptIds],
          misconceptionIds: [...activity.misconceptionIds],
          config: activity.config,
          grading: activity.grading,
          status: 'ready' as const,
          sourceRefs: [...activity.sourceRefs],
        })),
        ...collected.items.map((item, index) => ({
          ...item.row,
          lessonId: inserted.lesson.id,
          ordinal: reused.length + index,
        })),
      ]
      if (activityRows.length > 0) await tx.paths.createActivities(activityRows)
      if (bank.length > 0) await tx.itemBank.bumpExposure(bank.map((entry) => entry.id))

      if (card !== null) {
        const first = cardFragments[0]
        const item = await tx.knowledgeItems.create({
          lessonId: inserted.lesson.id,
          topicId: candidate.conceptId,
          kind: 'misconception',
          fields: {
            type: 'contrast',
            front: card.front,
            back: card.back,
            cloze_text: null,
            context_cue: null,
            interference_group: null,
            concept_ids: [candidate.conceptId],
            // Only the cite ids that name a fragment P11 was actually shown.
            citations: cardFragments.map((fragment) => fragment.citeId),
          },
          sourceId: first?.sourceId ?? null,
          annotationId: null,
          locator:
            first === undefined
              ? null
              : { label: first.locator, block_ids: [...first.blockIds], chunk_id: first.chunkId },
          asOf: null,
          importance: policy.boostLevel,
          status: 'need_to_learn',
          createdBy: 'ai',
          tags: ['remediation'],
        })
        await tx.cards.create(newCard(item.id, now))
      }

      if (boost.cardIds.length > 0) {
        await tx.cards.overrideImportance(boost.cardIds, policy.boostLevel, boost.expiresAt)
      }
      const lesson = await tx.paths.updateLesson(inserted.lesson.id, {
        title: collected.title ?? inserted.lesson.title,
        theory: asJson(assembled.theory),
        citations: assembled.citations.map((citation) => asJson(citation)),
        status: 'ready',
        estimatedMinutes: estimateMinutes(
          assembled.theory.word_count,
          itemCount,
          card !== null,
          policy,
        ),
        remediation: {
          ...(inserted.lesson.remediation ?? {}),
          item_bank_ids: bank.map((entry) => entry.id),
          generated_items: collected.items.length,
          contrast_card: card !== null,
          notes: [...collected.notes],
          rejected: collected.rejected.map((rejection) => rejection.code),
          warnings: assembled.warnings.map((entry) => asJson(entry)),
        },
      })
      const remediation = await tx.remediations.update(inserted.remediation.id, {
        boost: writeBoost({
          ...EMPTY_BOOST,
          cardIds: boost.cardIds,
          expiresAt: boost.cardIds.length === 0 ? null : boost.expiresAt.toISOString(),
        }),
      })
      return { remediation, lesson }
    })
  }

  // --- the signals ------------------------------------------------------------------------

  const onCardReviewed = async (
    cardId: string,
    rating: number,
    at: Date,
  ): Promise<RemediationDecision[]> => {
    // The raise first: a clean review of a boosted card counts toward its release.
    const boosted = await repos.remediations.listByStatus(['active', 'completed', 'dismissed'])
    for (const row of boosted) {
      const state = readBoost(row.boost)
      if (!state.cardIds.includes(cardId)) continue
      const next = onBoostedReview(state, cardId, rating, policy)
      if (next.state === state) continue
      if (next.release) {
        const card = await repos.cards.findById(cardId)
        if (card !== undefined && isOurOverride(card, state, policy)) {
          await repos.cards.overrideImportance([cardId], null, null)
        }
      }
      await repos.remediations.update(row.id, { boost: writeBoost(next.state) })
    }

    if (rating < 1) return []
    const card = await repos.cards.findById(cardId)
    const item = card === undefined ? undefined : await repos.knowledgeItems.findById(card.itemId)
    if (item === undefined || item.lessonId === null || item.topicId === null) return []
    const located = await versionOfLesson(item.lessonId)
    if (located === null) return []
    // A card may still hang off an older version's lesson (a "sin lección" orphan of a
    // regeneration): the trigger is the path's, so it is judged on the version being studied.
    const path = await repos.paths.findById(located.version.pathId)
    const active =
      path?.activeVersion == null || path.activeVersion === located.version.number
        ? located.version
        : await repos.paths.findVersionByNumber(path.id, path.activeVersion)
    if (active === undefined) return []

    const items = await repos.knowledgeItems.listByTopic(item.topicId)
    const cards = await repos.cards.listByItems(items.map((entry) => entry.id))
    const cardIds = new Set(cards.map((entry) => entry.id))
    const since = new Date(at.getTime() - policy.lapseWindowDays * DAY_MS)
    const logs = (await repos.reviewLogs.listSince(since, new Date(at.getTime() + 1))).filter(
      (log) => cardIds.has(log.cardId),
    )
    const retrievability =
      deps.retrievability ?? ((entry: Card, when: Date) => retrievabilityNow(entry, when))
    const candidate = memoryTrigger({
      pathVersionId: active.id,
      conceptId: item.topicId,
      now: at,
      logs: logs.map((log) => ({ rating: log.rating, state: log.state, review: log.review })),
      cards: cards.map((entry) => ({
        state: entry.state,
        retrievability: retrievability(entry, at),
      })),
    })
    return candidate === null ? [] : [await consider(candidate)]
  }

  const handleSignal = async (signal: RemediationSignal): Promise<RemediationDecision[]> => {
    switch (signal.kind) {
      case 'reinforcement_completed': {
        const decisions: RemediationDecision[] = []
        for (const candidate of reinforcementTriggers(signal, policy)) {
          decisions.push(await consider(candidate))
        }
        return decisions
      }
      case 'card_reviewed':
        return onCardReviewed(signal.cardId, signal.rating, signal.at)
      case 'confident_error': {
        const candidate = confidentErrorTrigger(signal)
        return candidate === null ? [] : [await consider(candidate)]
      }
      case 'misconception_failed': {
        const since = new Date(signal.at.getTime() - policy.misconceptionWindowDays * DAY_MS)
        // The earlier failures on record, plus the one that raised the signal — counted once
        // whether or not its attempt row has been written yet.
        const earlier = (await repos.attempts.listSince(since)).filter(
          (attempt) =>
            attempt.id !== signal.attemptId &&
            attempt.correct === false &&
            misconceptionOfAttempt(attempt) === signal.misconceptionId,
        ).length
        const candidate = misconceptionTrigger(
          {
            pathVersionId: signal.pathVersionId,
            conceptId: signal.conceptId,
            misconceptionId: signal.misconceptionId,
            failures: earlier + 1,
            lessonId: signal.lessonId ?? null,
            activityId: signal.activityId ?? null,
          },
          policy,
        )
        return candidate === null ? [] : [await consider(candidate)]
      }
      case 'not_understood': {
        const located = await versionOfLesson(signal.lessonId)
        if (located === null) return [{ kind: 'ignored', reason: 'lesson_not_found' }]
        const { lesson, version } = located
        // The renderer names the concept; only one of the lesson's own is taken from it.
        const conceptId =
          signal.conceptId !== undefined &&
          signal.conceptId !== null &&
          lesson.conceptIds.includes(signal.conceptId)
            ? signal.conceptId
            : lesson.conceptIds[0]
        if (conceptId === undefined) return [{ kind: 'ignored', reason: 'lesson_has_no_concept' }]
        return [
          await consider(
            userRequestTrigger({ pathVersionId: version.id, lessonId: lesson.id, conceptId }),
          ),
        ]
      }
    }
  }

  // --- the learner's two ways out, and the sweep -----------------------------------------

  const measure = async (row: Remediation, now: Date): Promise<JsonObject> => {
    const end = new Date(
      Math.min(now.getTime(), row.createdAt.getTime() + policy.outcomeWindowDays * DAY_MS),
    )
    const activities = await repos.paths.listActivitiesByConcepts([row.conceptId])
    const activityIds = new Set(activities.map((activity) => activity.id))
    const attempts = (await repos.attempts.listSince(row.createdAt, end)).filter(
      (attempt) => activityIds.has(attempt.activityId) && attempt.finishedAt !== null,
    )
    const items = await repos.knowledgeItems.listByTopic(row.conceptId)
    const cardIds = new Set(
      (await repos.cards.listByItems(items.map((item) => item.id))).map((card) => card.id),
    )
    const reviews = (await repos.reviewLogs.listSince(row.createdAt, end)).filter((log) =>
      cardIds.has(log.cardId),
    )
    return measureOutcome({ attempts, reviews, now: end })
  }

  const mustBeActive = async (remediationId: string): Promise<Remediation> => {
    const row = await repos.remediations.findById(remediationId)
    if (row === undefined) throw new RemediationError(`no remediation "${remediationId}"`)
    if (row.status !== 'active') {
      throw new RemediationError(`remediation "${remediationId}" is ${row.status}, not active`)
    }
    return row
  }

  const service: RemediationService = {
    handle: async (signal) => {
      try {
        return await handleSignal(signal)
      } catch (error) {
        deps.logger.error(`[pathgen] the remediation signal ${signal.kind} failed`, error)
        throw error
      }
    },

    list: (pathVersionId) => repos.remediations.listByPathVersion(pathVersionId),

    retire: async (pathVersionId, supersededBy) => {
      const open = (await repos.remediations.listByPathVersion(pathVersionId)).filter(
        (row) => row.status === 'active',
      )
      if (open.length === 0) return 0
      const now = clock.now()
      const closed = await repos.transaction(async (tx) => {
        const rows: Remediation[] = []
        for (const row of open) {
          rows.push(
            await tx.remediations.update(row.id, {
              status: 'dismissed',
              resolvedAt: now,
              evidence: { ...row.evidence, retired_by: supersededBy },
            }),
          )
        }
        return rows
      })
      for (const remediation of closed) emit({ kind: 'removed', remediation, lesson: null })
      return closed.length
    },

    complete: async (remediationId) => {
      const row = await mustBeActive(remediationId)
      const now = clock.now()
      const outcome = await measure(row, now)
      const items =
        row.lessonId === null ? [] : await repos.knowledgeItems.listByLesson(row.lessonId)
      const result = await repos.transaction(async (tx) => {
        const lesson =
          row.lessonId === null
            ? null
            : await tx.paths.updateLesson(row.lessonId, { completedAt: now })
        for (const item of items) {
          if (item.status === 'need_to_learn')
            await tx.knowledgeItems.update(item.id, { status: 'active' })
        }
        const remediation = await tx.remediations.update(row.id, {
          status: 'completed',
          resolvedAt: now,
          outcome,
        })
        return { remediation, lesson }
      })
      emit({ kind: 'updated', remediation: result.remediation, lesson: result.lesson })
      return result.remediation
    },

    dismiss: async (remediationId) => {
      const row = await mustBeActive(remediationId)
      const now = clock.now()
      const remediation = await repos.transaction(async (tx) => {
        if (row.lessonId !== null) await tx.paths.softDeleteLesson(row.lessonId)
        return tx.remediations.update(row.id, { status: 'dismissed', resolvedAt: now })
      })
      emit({ kind: 'removed', remediation, lesson: null })
      return remediation
    },

    sweep: async (now = clock.now()) => {
      const since = new Date(now.getTime() - 2 * policy.outcomeWindowDays * DAY_MS)
      let changed = 0
      for (const row of await repos.remediations.listSince(since)) {
        if (!INSERTED_STATUSES.has(row.status)) continue
        const outcome = await measure(row, now)
        const before = row.outcome ?? {}
        if (
          before.attempts === outcome.attempts &&
          before.reviews === outcome.reviews &&
          before.correct === outcome.correct &&
          before.clean_reviews === outcome.clean_reviews
        ) {
          continue
        }
        await repos.remediations.update(row.id, { outcome })
        changed += 1
      }
      return changed
    },
  }

  const exclusive = serialQueue()
  const locked =
    <A extends unknown[], R>(operation: (...args: A) => Promise<R>) =>
    (...args: A): Promise<R> =>
      exclusive(() => operation(...args))
  return {
    handle: locked(service.handle),
    list: service.list,
    complete: locked(service.complete),
    dismiss: locked(service.dismiss),
    sweep: locked(service.sweep),
    retire: locked(service.retire),
  }
}

function serialQueue(): <T>(work: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve()
  return (work) => {
    const next = tail.then(work, work)
    tail = next.catch(() => undefined)
    return next
  }
}
