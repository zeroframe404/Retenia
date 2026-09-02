import type { Entity, JsonObject } from './_common'
import type { XpReason } from './enums'

/** XP ledger, streaks and achievements (`docs/spec/08-ux.md` §3). Errors are never
 *  punished: `amount` is non-negative and there is nothing that subtracts. */

export interface XpEvent extends Entity {
  amount: number
  reason: XpReason
  subjectKind: string | null
  subjectId: string | null
  occurredAt: Date
  multiplier: number
  meta: JsonObject | null
}

export interface Streak extends Entity {
  /** `daily_goal`, `streak_goal`, … — one live row per kind. */
  kind: string
  currentLength: number
  longestLength: number
  goal: number
  /** ISO `YYYY-MM-DD` in the user's day-start timezone, not a timestamp. */
  lastActiveDay: string | null
  startedOn: string | null
  freezesAvailable: number
  freezesUsed: number
  freezeBankMax: number
  holidays: string[]
}

export interface Achievement extends Entity {
  key: string
  progress: number
  target: number
  unlockedAt: Date | null
  meta: JsonObject | null
}
