import type { Attempt, LessonSession } from '../entities'
import type { CrudRepository, EntityPatch, ListOptions, NewEntity } from './audit'

/** Activity attempts and the lesson sessions that group them. */
export interface AttemptRepository extends CrudRepository<Attempt> {
  listByCard(cardId: string, options?: ListOptions): Promise<Attempt[]>
  listBySession(lessonSessionId: string, options?: ListOptions): Promise<Attempt[]>
  listByExamAttempt(examAttemptId: string, options?: ListOptions): Promise<Attempt[]>
  listByActivity(activityId: string, options?: ListOptions): Promise<Attempt[]>
  /** Attempts recorded during one daily review session. */
  listByReviewSession(reviewSessionId: string, options?: ListOptions): Promise<Attempt[]>
  /**
   * When each of `activityIds` was last *answered*, for the session generator's "not the
   * same activity within 7 days" rule (`docs/spec/03-activities.md` §5).
   *
   * Finished attempts only: the row is opened when an activity is shown, so counting open
   * ones would let a skipped card suppress that activity for a week without the learner
   * having answered it.
   *
   * One query rather than one per activity: a due skill can have a dozen candidates and the
   * generator asks per entry, so the N+1 would be paid on every card of every session. Ids
   * with no attempt are simply absent from the map — the generator reads that as "never
   * served", which is what it is.
   */
  lastServedAt(activityIds: readonly string[]): Promise<Map<string, Date>>
  /** Attempts started in `[from, to)`, oldest first — the statistics screen's input. */
  listSince(from: Date, to?: Date, options?: ListOptions): Promise<Attempt[]>

  // --- lesson sessions ---
  findSession(id: string): Promise<LessonSession | undefined>
  listSessions(lessonId: string, options?: ListOptions): Promise<LessonSession[]>
  createSession(input: NewEntity<LessonSession>): Promise<LessonSession>
  updateSession(id: string, patch: EntityPatch<LessonSession>): Promise<LessonSession>
}
