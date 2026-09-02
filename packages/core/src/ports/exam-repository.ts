import type { Exam, ExamAttempt, ExamItem, ExamStatus } from '../entities'
import type { CrudRepository, EntityPatch, ListOptions, NewEntity } from './audit'

/** Exams, the items that make up a form, and the attempts at them. */
export interface ExamRepository extends CrudRepository<Exam> {
  listByStatus(status: ExamStatus, options?: ListOptions): Promise<Exam[]>
  listByPath(pathId: string, options?: ListOptions): Promise<Exam[]>
  /** Dated exams still ahead of `from`, soonest first — what the exam scheduler plans for. */
  listUpcoming(from: Date, options?: ListOptions): Promise<Exam[]>

  // --- items ---
  listItems(examId: string, options?: ListOptions): Promise<ExamItem[]>
  createItems(inputs: readonly NewEntity<ExamItem>[]): Promise<ExamItem[]>
  /** Soft-deletes the exam's current items and inserts these instead, in one transaction. */
  replaceItems(examId: string, items: readonly NewEntity<ExamItem>[]): Promise<ExamItem[]>

  // --- attempts ---
  findAttempt(id: string): Promise<ExamAttempt | undefined>
  listAttempts(examId: string, options?: ListOptions): Promise<ExamAttempt[]>
  startAttempt(input: NewEntity<ExamAttempt>): Promise<ExamAttempt>
  updateAttempt(id: string, patch: EntityPatch<ExamAttempt>): Promise<ExamAttempt>
}
