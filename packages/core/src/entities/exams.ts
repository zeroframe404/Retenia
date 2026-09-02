import type { Entity, JsonObject, JsonValue } from './_common'
import type { ExamAttemptMode, ExamForm, ExamKind, ExamStatus, ItemUsage } from './enums'

/** Dated, mock, final and diagnostic exams, their items and attempts, plus the generated
 *  item bank (`docs/spec/02-memory-system.md` §11, `docs/spec/04-path-generation.md` §9). */

export interface Exam extends Entity {
  title: string
  kind: ExamKind
  /** ISO `YYYY-MM-DD`; null for undated mock exams. */
  date: string | null
  pathId: string | null
  scope: JsonObject
  blueprint: JsonValue[]
  targetRetention: number
  finalWindowDays: number
  /** Bitmask of the weekdays the user studies, Monday = bit 0. */
  studyDaysMask: number
  dailyCapacityMinutes: number | null
  status: ExamStatus
}

/** An activity promoted to the reusable bank, with its calibration statistics. */
export interface ItemBankEntry extends Entity {
  activityId: string
  pathVersionId: string | null
  moduleId: string | null
  usage: ItemUsage[]
  difficultyLogit: number
  discriminationHint: number | null
  exposure: number
  stats: JsonObject
}

export interface ExamItem extends Entity {
  examId: string
  ordinal: number
  activityId: string
  itemBankId: string | null
  form: ExamForm | null
  topic: string | null
  weight: number
  timeLimitSec: number | null
}

export interface ExamAttempt extends Entity {
  examId: string
  mode: ExamAttemptMode
  startedAt: Date
  finishedAt: Date | null
  score: number | null
  byTopic: JsonObject
  items: JsonValue[]
  readinessPredicted: number | null
  /** Whether the attempt's ratings feed the scheduler (a `preview` run does not). */
  affectsScheduling: boolean
}
