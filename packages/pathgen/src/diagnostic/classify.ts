import type { ConfidenceLevel } from '@retenia/core'
import { compareNumbers } from '../graph/order'
import { sigmoid } from './elo'
import { withinHops } from './propagate'
import {
  type AnswerOutcome,
  CLASSIFICATION,
  DIAGNOSTIC_LIMITS,
  type ModuleGraph,
  type ModuleStatus,
  type StatusSource,
} from './types'

/**
 * §10 step 6 — classification, `P = σ(θ)`:
 * - **known** `≥ 0.8` with `n ≥ 2` answers of the module's own, *or* one "apply" item answered
 *   correctly and confidently with every prerequisite already known (pitfall 10: an
 *   overconfident self-assessment is confirmed by at least one apply item, never trusted);
 * - **partial** `0.4–0.8`;
 * - **unknown** `< 0.4`.
 *
 * "Settled" is what the selector and the stop rule read: a module is settled when more
 * questions would not change what the diagnostic does with it — known or unknown on the
 * evidence, or partial with its three items spent. A module nobody asked anything about, and
 * that no propagation reached, is `unknown` and unsettled: the safe default is to study it.
 */

export type ModuleEvidence =
  | {
      readonly kind: 'answer'
      readonly itemId: string
      readonly outcome: AnswerOutcome
      readonly confidence: ConfidenceLevel | null
      readonly delta: number
    }
  | { readonly kind: 'inferred'; readonly fromModuleId: string; readonly delta: number }

export interface ModuleEstimate {
  readonly theta: number
  /** Answers of the module's own that moved θ — the `n` of `K(n)` and of "n ≥ 2". */
  readonly answered: number
  /** Items served, skips included — the "maximum 3 per module" counter. */
  readonly served: number
  /** Propagated updates received. Evidence, but never an answer. */
  readonly inferred: number
  readonly sureApplyCorrect: boolean
  /** Set when the status is not the diagnostic's to decide. */
  readonly fixed: ModuleStatus | null
  readonly fixedSource: Exclude<StatusSource, 'diagnostic' | 'unevidenced'> | null
  readonly evidence: readonly ModuleEvidence[]
}

export interface ModuleClassification {
  readonly status: ModuleStatus
  readonly settled: boolean
  readonly p: number
  readonly source: StatusSource
}

export function classifyModules(
  graph: ModuleGraph,
  estimates: ReadonlyMap<string, ModuleEstimate>,
): Map<string, ModuleClassification> {
  const out = new Map<string, ModuleClassification>()
  // Parents first: "with known ancestors" reads their verdicts. Longest-path depth puts every
  // parent strictly above its children.
  const order = [...graph.modules].sort(
    (a, b) =>
      compareNumbers(graph.depth.get(a.id) ?? 0, graph.depth.get(b.id) ?? 0) ||
      compareNumbers(a.ordinal, b.ordinal),
  )
  for (const module of order) {
    const estimate = estimates.get(module.id)
    if (estimate === undefined) continue
    const p = sigmoid(estimate.theta)
    if (estimate.fixed !== null) {
      out.set(module.id, {
        status: estimate.fixed,
        settled: true,
        p,
        source: estimate.fixedSource ?? 'diagnostic',
      })
      continue
    }
    // "With known ancestors" (§10 step 6): every module upstream, not just the direct
    // parents — a parent can be known on its own two answers while one of its own
    // prerequisites is not, and the shortcut must not inherit that gap.
    const ancestorsKnown = [
      ...withinHops(graph.parents, module.id, graph.modules.length).keys(),
    ].every((id) => out.get(id)?.status === 'known')
    const known =
      p >= CLASSIFICATION.known &&
      (estimate.answered >= CLASSIFICATION.knownMinAnswers ||
        (estimate.sureApplyCorrect && ancestorsKnown))
    if (known) {
      out.set(module.id, { status: 'known', settled: true, p, source: 'diagnostic' })
    } else if (estimate.answered + estimate.inferred === 0) {
      out.set(module.id, { status: 'unknown', settled: false, p, source: 'unevidenced' })
    } else if (p < CLASSIFICATION.unknown) {
      out.set(module.id, { status: 'unknown', settled: true, p, source: 'diagnostic' })
    } else {
      out.set(module.id, {
        status: 'partial',
        settled: estimate.served >= DIAGNOSTIC_LIMITS.maxPerModule,
        p,
        source: 'diagnostic',
      })
    }
  }
  return out
}
