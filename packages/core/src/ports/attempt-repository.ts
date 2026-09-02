import type { Attempt, LessonSession } from '../entities'
import type { CrudRepository, EntityPatch, ListOptions, NewEntity } from './audit'

/** Activity attempts and the lesson sessions that group them. */
export interface AttemptRepository extends CrudRepository<Attempt> {
  listByCard(cardId: string, options?: ListOptions): Promise<Attempt[]>
  listBySession(lessonSessionId: string, options?: ListOptions): Promise<Attempt[]>
  listByExamAttempt(examAttemptId: string, options?: ListOptions): Promise<Attempt[]>
  listByActivity(activityId: string, options?: ListOptions): Promise<Attempt[]>
  /** Attempts started in `[from, to)`, oldest first — the statistics screen's input. */
  listSince(from: Date, to?: Date, options?: ListOptions): Promise<Attempt[]>

  // --- lesson sessions ---
  findSession(id: string): Promise<LessonSession | undefined>
  listSessions(lessonId: string, options?: ListOptions): Promise<LessonSession[]>
  createSession(input: NewEntity<LessonSession>): Promise<LessonSession>
  updateSession(id: string, patch: EntityPatch<LessonSession>): Promise<LessonSession>
}
