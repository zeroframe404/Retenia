/**
 * The run's own cost cap (`GenerationConfig.budgetCapUsd`), as one object every stage asks
 * before it spends.
 *
 * Distinct from the monthly budget `@retenia/ai` enforces on every call: that one is the
 * household's, this one is the question "how much may *this* path cost?" the wizard asks
 * beside the estimate. Both are soft in the same way — a run over the cap pauses as
 * `blocked_budget` with its progress saved, and "continue anyway" resumes it with
 * `allowOverBudget`, which is what turns this guard off.
 */
export interface BudgetGuard {
  /** `0` means no cap, the same reading `ai.budget.monthlyUsd` has. */
  readonly capUsd: number
  spentUsd(): number
  /** Record what a stage just spent. Cache hits cost nothing and never count. */
  add(usd: number): void
  /** Whether spending `estimateUsd` more would take the run past its cap. Never with no cap. */
  wouldExceed(estimateUsd: number): boolean
}

export function createBudgetGuard(capUsd: number, spentUsd = 0): BudgetGuard {
  let spent = spentUsd
  return {
    capUsd,
    spentUsd: () => spent,
    add: (usd) => {
      spent += usd
    },
    wouldExceed: (estimateUsd) => capUsd > 0 && spent + estimateUsd > capUsd,
  }
}

/** A guard that never blocks — what `allowOverBudget` and a run with no cap get. */
export const UNLIMITED_BUDGET: BudgetGuard = Object.freeze({
  capUsd: 0,
  spentUsd: () => 0,
  add: () => {},
  wouldExceed: () => false,
})
