import type { GradeMeta, GradeResult, PerItem } from '@retenia/activity-schema'
import type { GradeMeta as CoreGradeMeta } from '@retenia/core'

/** What every grader takes from the host: the raw attempt measurements of §13. */
export type AttemptMeta = CoreGradeMeta

export interface ResultFields {
  score: number
  correct: boolean
  feedback: string
  perItem?: PerItem[]
  rating?: GradeResult['rating']
  meta?: Partial<GradeMeta>
}

/** Clamps the score into `[0, 1]` and fills the fields every result carries. */
export function result(meta: AttemptMeta, fields: ResultFields): GradeResult {
  const score = Math.min(1, Math.max(0, fields.score))
  return {
    score,
    correct: fields.correct,
    ...(fields.perItem === undefined ? {} : { perItem: fields.perItem }),
    feedback: fields.feedback,
    rating: fields.rating ?? null,
    meta: { ...meta, ...fields.meta },
  }
}

export function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`
}
