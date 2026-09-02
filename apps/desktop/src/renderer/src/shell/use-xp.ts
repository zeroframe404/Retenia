/** The top bar's XP total. XP, streaks and goals land in sub-phase 13.1 — until then there
 * is nothing earned, so this returns `0` rather than fake data. Swap the body for a real
 * `useIpcQuery('gamification.summary', …)` once that channel exists. */
export function useXp(): number {
  return 0
}
