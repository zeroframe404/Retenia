import type { JsonValue } from '@retenia/core'
import type { ExpandRepos } from '../expand/deps'
import { asJson } from '../json'
import type { LessonCitation, LessonTheory } from '../schemas/lesson'
import type { LessonQa } from './lesson-qa'

/**
 * The one write of stage 8, in one transaction: the theory as the gates left it (stripped
 * markers, edited blocks), the citations with their upgraded quotes, the verdict, the status
 * — and the duplicate activities the verdict decided the block could spare.
 *
 * One write rather than one per gate, because a row must never carry half a review: a
 * crash between "markers stripped" and "verdict written" would leave a lesson that reads as
 * unreviewed with a theory that already was, and the resume would strip it again on top.
 * With one write the resume finds either the pre-QA row or the finished one.
 */

export interface PersistQaInput {
  readonly lessonId: string
  readonly theory: LessonTheory
  readonly citations: readonly LessonCitation[]
  readonly qa: LessonQa
  readonly duplicateActivityIds: readonly string[]
}

export async function persistQa(
  repos: Pick<ExpandRepos, 'paths' | 'transaction'>,
  input: PersistQaInput,
): Promise<void> {
  await repos.transaction(async (tx) => {
    for (const id of input.duplicateActivityIds) await tx.paths.softDeleteActivity(id)
    await tx.paths.updateLesson(input.lessonId, {
      theory: asJson(input.theory),
      citations: input.citations as unknown as JsonValue[],
      qa: asJson(input.qa),
      status: 'ready',
    })
  })
}
