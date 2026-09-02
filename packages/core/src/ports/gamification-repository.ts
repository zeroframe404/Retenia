import type { Achievement, Streak, XpEvent } from '../entities'
import type { EntityPatch, ListOptions, NewEntity } from './audit'

export interface XpRange {
  from: Date
  to?: Date
}

/**
 * XP, streaks and achievements. The XP ledger is append-only and aggregates are derived
 * from it, so a corrected total can never drift from its history.
 */
export interface GamificationRepository {
  // --- XP ---
  appendXp(input: NewEntity<XpEvent>): Promise<XpEvent>
  listXp(range: XpRange, options?: ListOptions): Promise<XpEvent[]>
  /** `sum(amount * multiplier)` over the window, rounded down to a whole number of XP. */
  totalXp(range?: XpRange): Promise<number>
  /** XP per calendar day (ISO `YYYY-MM-DD`, in UTC), for the heatmap. */
  xpByDay(range: XpRange): Promise<Array<{ day: string; xp: number }>>

  // --- streaks ---
  getStreak(kind: string): Promise<Streak | undefined>
  createStreak(input: NewEntity<Streak>): Promise<Streak>
  updateStreak(kind: string, patch: EntityPatch<Streak>): Promise<Streak>

  // --- achievements ---
  getAchievement(key: string): Promise<Achievement | undefined>
  listAchievements(options?: ListOptions): Promise<Achievement[]>
  /** Creates the row on first sight, updates it after — achievements are declared in code
   *  and materialize the first time progress is made. */
  upsertAchievement(
    key: string,
    patch: Omit<NewEntity<Achievement>, 'key'> & { key?: string },
  ): Promise<Achievement>
}
