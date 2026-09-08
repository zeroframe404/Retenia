/**
 * The monthly cap and its 80/100 % alerts (`docs/spec/06-ai-providers.md` §6: "monthly
 * budget with alerts at 80/100 % and optional blocking").
 */

/**
 * The **local** calendar month.
 *
 * Two reasons, and the second is the one that bites. A budget lines up with a provider's
 * invoice and with what a person means by "this month" — not with `review.dayStartHour`,
 * which is a study-day boundary and a different question. And building the boundary with
 * the local `new Date(y, m, 1)` constructor is what makes the tests give the same answer
 * on a UTC CI runner and on an ART (UTC-3) machine.
 *
 * Every date in this module's tests is built the same way, never from an ISO string ending
 * in `Z` — an ISO fixture near a month edge silently flips the month depending on where it
 * runs, and the tempting fix for the resulting failure is exactly the change that breaks it.
 */
export function startOfMonth(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), 1)
}

/** `YYYY-MM` in local time, for `AiBudgetEvent.period`. */
export function monthKey(at: Date): string {
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}`
}

export const WARNING_THRESHOLD = 0.8

/** A cap of 0 means **no cap**, not "block everything" — see `run.ts`. */
export function budgetState(spentUsd: number, capUsd: number): 'ok' | 'warning' | 'exhausted' {
  if (capUsd <= 0) return 'ok'
  const ratio = spentUsd / capUsd
  if (ratio >= 1) return 'exhausted'
  return ratio >= WARNING_THRESHOLD ? 'warning' : 'ok'
}

export interface AiBudgetEvent {
  /** `threshold` = a line was crossed; `blocked` = a call was refused or waved through. */
  readonly kind: 'threshold' | 'blocked'
  readonly period: string
  readonly threshold?: 80 | 100
  readonly spentUsd: number
  readonly capUsd: number
  readonly purpose?: string
}

/**
 * Which thresholds a call's spend crossed, given the month's total before and after it.
 *
 * Keyed on the *transition* rather than on the current state, which is what makes an alert
 * fire once per month with no latch to store and no bookkeeping to get wrong: `before`
 * comes from `sumCost` over the real rows, so a restart re-reads the same total and a
 * threshold already behind us cannot fire again.
 */
export function crossedThresholds(
  spentBefore: number,
  spentAfter: number,
  capUsd: number,
): readonly (80 | 100)[] {
  if (capUsd <= 0) return []
  const crossed: (80 | 100)[] = []
  for (const threshold of [80, 100] as const) {
    const line = (capUsd * threshold) / 100
    if (spentBefore < line && spentAfter >= line) crossed.push(threshold)
  }
  return crossed
}
