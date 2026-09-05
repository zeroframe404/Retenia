import type { Activity } from '@retenia/activity-schema'
import { safeParseActivity, toActivityOption } from '@retenia/activity-schema'
import type {
  ActivityOption,
  ActivitySelection,
  ActivitySelector,
  Attempt,
  BloomLevel,
  JsonObject,
  JsonValue,
  KnowledgeItem,
  Rating,
  SessionCardEntry,
  UnitOfWork,
} from '@retenia/core'
import { createActivitySelector } from '@retenia/core'
import { log } from '../logging/log'

/**
 * The main-process half of the runtime activity selector (`docs/spec/03-activities.md` §5).
 *
 * `@retenia/core` decides *which* activity a due skill gets; everything it cannot reach from
 * a zero-dependency package lives here — the skill → activity join, the attempt history the
 * 7-day rule reads, parsing the stored row back into an envelope, and minting the `attempts`
 * row the answer will be filed under.
 *
 * It fails **soft, and loudly**. A skill with no usable activity is not an error: the runner
 * renders the plain flashcard, which is what §5's fallback has always been and what makes a
 * session mix cards and exercises. A stored activity that will not parse is a content bug —
 * logged and skipped, never allowed to take a review session down with it.
 */

export interface ServedActivity {
  attemptId: string
  activityId: string
  type: string
  /** The envelope, as JSON for the bridge. */
  activity: JsonObject
  mode: ActivitySelection['mode']
  hintsAllowed: boolean
  deferFeedback: boolean
  seed: string
}

export interface ActivityServiceDeps {
  repos: UnitOfWork
  /** `SessionPlan.seed`, so the same session replays the same activities. */
  seed: string
  /** The review session the attempts belong to. */
  reviewSessionId: string
}

/** What the host measured about one answer, for the `attempts` row it is filed on. */
export interface AttemptOutcome {
  attemptId: string
  activityId: string
  rating: Rating
  score: number | null
  correct: boolean | null
  answer: JsonValue | null
  feedback: JsonValue | null
  timeMs: number | null
  tries: number
  hintsUsed: number
}

export interface ActivityService {
  /** The exercise to render for this entry, or `null` to render the flashcard. */
  serve(entry: SessionCardEntry, item: KnowledgeItem | null): Promise<ServedActivity | null>
  /**
   * Close the attempt the answer belongs to and spend the session's variety budgets.
   *
   * Called after `reviewCard` has written the review, not before: the `attempts` row is
   * opened when the activity is *served* so `review_logs.attempt_id` has something to point
   * at, and filled in here once there is an answer to record.
   */
  complete(outcome: AttemptOutcome): Promise<void>
}

/**
 * The concepts a card exercises.
 *
 * `knowledge_items.topic_id` is the concept id in the path version's knowledge graph and
 * `activities.concept_ids` is what an activity declares, so this one field is the whole
 * skill → activity join. An item with no topic has no concept and therefore no exercises —
 * an imported Anki note, say, which is reviewed as the flashcard it is.
 */
/**
 * How many candidate activities one skill may draw from.
 *
 * The selector only needs a pool, not the catalogue: every row read here has its envelope
 * zod-parsed, and this is the per-card hot path of a review session. A concept with more
 * authored activities than this loses nothing but the tail of a list it was going to pick
 * one item from.
 */
const MAX_CANDIDATES = 200

function conceptsOf(item: KnowledgeItem | null): string[] {
  return item?.topicId == null ? [] : [item.topicId]
}

export function createActivityService(deps: ActivityServiceDeps): ActivityService {
  const { repos } = deps
  const selector: ActivitySelector = createActivitySelector({ seed: deps.seed })
  /** Kept between `serve` and `complete` so the budget is spent without re-reading the row. */
  const pending = new Map<string, ActivitySelection>()
  /**
   * What has already been served for a card, so `serve` is idempotent.
   *
   * `SessionRunner.next()` is documented pure — *"it starts the per-card timer but writes
   * nothing"* — and the review screen re-calls it on every render and after every
   * `<Activity>` hide/show. Without this, each of those calls would mint another `attempts`
   * row for the same card and re-roll which exercise is on screen under the learner. The
   * entry is dropped once its answer closes it, so the final drill re-serving a card later
   * still gets a fresh pick.
   */
  const servedByCard = new Map<string, ServedActivity>()
  /**
   * The attempts this session opened.
   *
   * `complete` is reached from `session.answer`, whose `attemptId` comes across the bridge —
   * so it is renderer input, and the zod contract only proves it is *a* UUID. Without this
   * set, a bug (or a compromised renderer) could name any row in `attempts` and have this
   * overwrite it with another card's answer. Main knows which rows it opened; nothing else
   * is writable from here.
   */
  const opened = new Set<string>()

  return {
    serve: async (entry, item) => {
      const already = servedByCard.get(entry.card.id)
      if (already !== undefined) return already

      const conceptIds = conceptsOf(item)
      if (conceptIds.length === 0) return null

      const envelopes = new Map<string, { activity: Activity; bloom: BloomLevel | null }>()
      try {
        for (const row of await repos.paths.listActivitiesByConcepts(conceptIds, {
          limit: MAX_CANDIDATES,
        })) {
          // `activities.config` holds the envelope minus `grading`, which is its own column.
          const parsed = safeParseActivity({
            ...(row.config as JsonObject),
            id: row.id,
            grading: row.grading,
          })
          if (!parsed.success) {
            log.warn(`[activity] ${row.id} does not parse as an activity; skipping it`)
            continue
          }
          envelopes.set(row.id, { activity: parsed.data, bloom: row.bloom })
        }
      } catch (error) {
        // §11's three validation layers run at generation time; this is the last line, and
        // a flashcard is always a safe answer.
        log.warn(`[activity] could not load activities for card ${entry.card.id}:`, error)
        return null
      }
      if (envelopes.size === 0) return null

      const lastServed = await repos.attempts.lastServedAt([...envelopes.keys()])
      const options: ActivityOption[] = [...envelopes.values()].map((entry_) =>
        toActivityOption(entry_.activity, {
          lastServedAt: lastServed.get(entry_.activity.id) ?? null,
          bloom: entry_.bloom,
        }),
      )

      const selection = selector.select(entry, options)
      if (selection === null) return null
      const chosen = envelopes.get(selection.option.activityId)
      /* c8 ignore next -- `options` is built from `envelopes`, so the id is always present. */
      if (chosen === undefined) return null

      let attempt: Attempt
      try {
        attempt = await repos.attempts.create({
          activityId: selection.option.activityId,
          context: 'review',
          mode: selection.mode,
          lessonSessionId: null,
          reviewSessionId: deps.reviewSessionId,
          examAttemptId: null,
          cardId: entry.card.id,
          startedAt: new Date(),
          finishedAt: null,
          score: null,
          correct: null,
          rating: null,
          answer: null,
          feedback: null,
          timeMs: null,
          tries: 1,
          hintsUsed: 0,
          confidence: null,
          aiEvalCallId: null,
        })
      } catch (error) {
        // The insert is on the same fail-soft contract as the read above: a review that
        // cannot be *recorded* as an exercise is still a review, and the flashcard path
        // writes no attempt row at all.
        log.warn(`[activity] could not open an attempt for card ${entry.card.id}:`, error)
        return null
      }

      pending.set(selection.option.activityId, selection)
      const result: ServedActivity = {
        attemptId: attempt.id,
        activityId: selection.option.activityId,
        type: selection.option.type,
        activity: chosen.activity as unknown as JsonObject,
        mode: selection.mode,
        hintsAllowed: selection.hintsAllowed,
        deferFeedback: selection.deferFeedback,
        // Per card, so the host's option shuffle is stable across re-renders but two cards
        // that happen to share an activity do not shuffle it identically.
        seed: `${deps.seed}:${entry.card.id}`,
      }
      servedByCard.set(entry.card.id, result)
      opened.add(attempt.id)
      return result
    },

    complete: async (outcome) => {
      if (!opened.has(outcome.attemptId)) {
        log.warn(
          `[activity] refusing to close attempt ${outcome.attemptId}: this session did not open it`,
        )
        return
      }
      const selection = pending.get(outcome.activityId)
      if (selection !== undefined) {
        selector.commit(selection)
        pending.delete(outcome.activityId)
      }
      opened.delete(outcome.attemptId)
      for (const [cardId, served] of servedByCard) {
        if (served.attemptId === outcome.attemptId) servedByCard.delete(cardId)
      }
      try {
        await repos.attempts.update(outcome.attemptId, {
          finishedAt: new Date(),
          score: outcome.score,
          correct: outcome.correct,
          rating: outcome.rating,
          answer: outcome.answer,
          feedback: outcome.feedback,
          timeMs: outcome.timeMs,
          tries: outcome.tries,
          hintsUsed: outcome.hintsUsed,
        })
      } catch (error) {
        // The review itself is already written and is the thing that matters; an attempt row
        // that stayed open costs statistics, not memory state.
        log.warn(`[activity] could not close attempt ${outcome.attemptId}:`, error)
      }
    },
  }
}
