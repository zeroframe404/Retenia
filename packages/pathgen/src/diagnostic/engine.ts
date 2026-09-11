import { compareNumbers, compareStrings } from '../graph/order'
import { classifyModules, type ModuleClassification, type ModuleEstimate } from './classify'
import { isApplyOrAbove, thetaDelta } from './elo'
import { propagationTargets } from './propagate'
import {
  ANSWER_OUTCOMES,
  DEFAULT_TUNING,
  DIAGNOSTIC_LIMITS,
  type DiagnosticAnswer,
  type DiagnosticConfig,
  type DiagnosticItem,
  type DiagnosticModule,
  type DiagnosticTuning,
  type StopReason,
} from './types'

/**
 * The adaptive loop of `docs/spec/04-path-generation.md` §10, steps 1–7, as pure functions
 * over an immutable state: `startDiagnostic` → (`nextItem` → `answerItem`)* → `stopReason`.
 *
 * Resumability is replay. The persisted form of a diagnostic in progress is its
 * configuration and its answer log; `replayDiagnostic` folds the log back into exactly the
 * state an uninterrupted run had, because every answer carries the difficulty it was served
 * at and nothing here reads a clock or a random number.
 */

/** θ reported for a module whose status was fixed rather than estimated: P ≈ 0.95 / 0.05. */
export const FIXED_KNOWN_THETA = 3
export const FIXED_UNKNOWN_THETA = -3

export const DIAGNOSTIC_ERROR_CODES = [
  'diagnostic_stopped',
  'unknown_item',
  'item_already_answered',
  'module_not_askable',
  'invalid_answer',
] as const
export type DiagnosticErrorCode = (typeof DIAGNOSTIC_ERROR_CODES)[number]

export class DiagnosticError extends Error {
  override readonly name = 'DiagnosticError'
  readonly code: DiagnosticErrorCode
  constructor(code: DiagnosticErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

/** A "sure" wrong answer (§10 step 3): the input of `insert_remediation`. */
export interface ConfidentMisconception {
  readonly moduleId: string
  readonly itemId: string
  readonly conceptIds: readonly string[]
  /** The misconception behind the option chosen, when the item mapped it. */
  readonly misconceptionId: string | null
}

export interface DiagnosticState {
  readonly config: DiagnosticConfig
  readonly tuning: DiagnosticTuning
  readonly estimates: ReadonlyMap<string, ModuleEstimate>
  readonly answers: readonly DiagnosticAnswer[]
  readonly usedItemIds: ReadonlySet<string>
  /** §10 step 5: "no repeated concept". */
  readonly askedConceptIds: ReadonlySet<string>
  /** Active time: the sum of the answers' `timeMs`, never wall-clock time. */
  readonly elapsedMs: number
  readonly misconceptions: readonly ConfidentMisconception[]
  readonly abandoned: boolean
}

const itemIndexes = new WeakMap<DiagnosticConfig, ReadonlyMap<string, DiagnosticItem>>()

function itemIndex(config: DiagnosticConfig): ReadonlyMap<string, DiagnosticItem> {
  let index = itemIndexes.get(config)
  if (index === undefined) {
    index = new Map(config.items.map((item) => [item.id, item]))
    itemIndexes.set(config, index)
  }
  return index
}

function initialEstimate(
  module: DiagnosticModule,
  config: DiagnosticConfig,
  declared: ReadonlySet<string>,
  tuning: DiagnosticTuning,
): ModuleEstimate {
  const blank = { answered: 0, served: 0, inferred: 0, sureApplyCorrect: false, evidence: [] }
  if (declared.has(module.id)) {
    return { ...blank, theta: FIXED_KNOWN_THETA, fixed: 'known', fixedSource: 'self_declared' }
  }
  if (config.entry === 'scratch') {
    return { ...blank, theta: FIXED_UNKNOWN_THETA, fixed: 'unknown', fixedSource: 'from_scratch' }
  }
  const level = config.selfAssessment[module.sectionId] ?? 'familiar'
  if (level === 'never') {
    return { ...blank, theta: FIXED_UNKNOWN_THETA, fixed: 'unknown', fixedSource: 'never_seen' }
  }
  return { ...blank, theta: tuning.priors[level], fixed: null, fixedSource: null }
}

/** §10 step 1. */
export function startDiagnostic(
  config: DiagnosticConfig,
  tuning: DiagnosticTuning = DEFAULT_TUNING,
): DiagnosticState {
  const declared = new Set(config.selfDeclaredKnown ?? [])
  const estimates = new Map<string, ModuleEstimate>()
  for (const module of config.graph.modules) {
    estimates.set(module.id, initialEstimate(module, config, declared, tuning))
  }
  return {
    config,
    tuning,
    estimates,
    answers: [],
    usedItemIds: new Set(),
    askedConceptIds: new Set(),
    elapsedMs: 0,
    misconceptions: [],
    abandoned: false,
  }
}

export function classify(state: DiagnosticState): Map<string, ModuleClassification> {
  return classifyModules(state.config.graph, state.estimates)
}

/** Items of `moduleId` still servable: unused, and on no concept already asked. */
export function eligibleItems(state: DiagnosticState, moduleId: string): DiagnosticItem[] {
  return state.config.items.filter(
    (item) =>
      item.moduleId === moduleId &&
      !state.usedItemIds.has(item.id) &&
      item.conceptIds.every((id) => !state.askedConceptIds.has(id)),
  )
}

/** Modules a question may still go to: estimated, unsettled, under three items, with items. */
export function askableModules(
  state: DiagnosticState,
  classification: ReadonlyMap<string, ModuleClassification> = classify(state),
): DiagnosticModule[] {
  return state.config.graph.modules.filter((module) => {
    const estimate = state.estimates.get(module.id) as ModuleEstimate
    return (
      estimate.fixed === null &&
      classification.get(module.id)?.settled === false &&
      estimate.served < DIAGNOSTIC_LIMITS.maxPerModule &&
      eligibleItems(state, module.id).length > 0
    )
  })
}

/** §10 step 7, or `null` while the diagnostic should go on. */
export function stopReason(state: DiagnosticState): StopReason | null {
  if (state.config.entry === 'scratch') return 'from_scratch'
  if (state.abandoned) return 'abandoned'
  if (state.answers.length >= DIAGNOSTIC_LIMITS.maxItems) return 'max_items'
  if (state.elapsedMs >= DIAGNOSTIC_LIMITS.hardTimeMs) return 'time_limit'
  const classification = classify(state)
  const open = askableModules(state, classification)
  if (open.length === 0) {
    const unsettled = state.config.graph.modules.some(
      (module) => classification.get(module.id)?.settled === false,
    )
    return unsettled ? 'no_items' : 'all_classified'
  }
  // 25–30 items and 12–15 minutes: past the lower bound, only an important module that is
  // still open earns the extra questions.
  const importantOpen = open.some(
    (module) => module.importance >= DIAGNOSTIC_LIMITS.importantModule,
  )
  if (state.answers.length >= DIAGNOSTIC_LIMITS.softMaxItems && !importantOpen) return 'max_items'
  if (state.elapsedMs >= DIAGNOSTIC_LIMITS.softTimeMs && !importantOpen) return 'time_limit'
  return null
}

function median<T>(sorted: readonly T[]): T {
  return sorted[Math.floor((sorted.length - 1) / 2)] as T
}

/** §10 steps 2 and 5: the next item to serve, or `null` when the diagnostic has stopped. */
export function nextItem(state: DiagnosticState): DiagnosticItem | null {
  if (stopReason(state) !== null) return null
  const open = askableModules(state)
  const depthOf = (module: DiagnosticModule) => state.config.graph.depth.get(module.id) ?? 0

  if (state.answers.length === 0) {
    // Step 2: "the mid-depth module of the DAG with its mid item" — the start that learns the
    // most from propagation whichever way the first answer goes.
    const middle = median([...open.map(depthOf)].sort(compareNumbers))
    const start = open
      .filter((module) => depthOf(module) === middle)
      .sort((a, b) => compareNumbers(b.importance, a.importance) || a.ordinal - b.ordinal)[0]
    const pool = eligibleItems(state, (start as DiagnosticModule).id).sort(
      (a, b) => compareNumbers(a.difficultyLogit, b.difficultyLogit) || compareStrings(a.id, b.id),
    )
    return median(pool)
  }

  // Step 5: "the most uncertain module weighted by importance". 4P(1−P) is 1 at P = 0.5 and 0
  // at certainty.
  let best: DiagnosticModule | null = null
  let bestScore = Number.NEGATIVE_INFINITY
  for (const module of open) {
    const theta = (state.estimates.get(module.id) as ModuleEstimate).theta
    const p = 1 / (1 + Math.exp(-theta))
    const score = (state.tuning.importanceBias + module.importance) * 4 * p * (1 - p)
    if (score > bestScore) {
      best = module
      bestScore = score
    }
  }
  const chosen = best as DiagnosticModule
  const theta = (state.estimates.get(chosen.id) as ModuleEstimate).theta
  // "Difficulty ≈ θ", then the least-exposed, then the id: total, so a replay picks the same.
  return eligibleItems(state, chosen.id).sort(
    (a, b) =>
      compareNumbers(Math.abs(a.difficultyLogit - theta), Math.abs(b.difficultyLogit - theta)) ||
      compareNumbers(a.exposure, b.exposure) ||
      compareStrings(a.id, b.id),
  )[0] as DiagnosticItem
}

function assertAnswer(answer: DiagnosticAnswer): void {
  if (!ANSWER_OUTCOMES.includes(answer.outcome)) {
    throw new DiagnosticError('invalid_answer', `unknown outcome "${String(answer.outcome)}"`)
  }
  if (!Number.isFinite(answer.timeMs) || answer.timeMs < 0) {
    throw new DiagnosticError('invalid_answer', 'timeMs must be a finite number ≥ 0')
  }
  if (!Number.isFinite(answer.difficulty)) {
    throw new DiagnosticError('invalid_answer', 'difficulty must be a finite number')
  }
}

function applyAnswer(state: DiagnosticState, answer: DiagnosticAnswer): DiagnosticState {
  assertAnswer(answer)
  const item = itemIndex(state.config).get(answer.itemId)
  if (item === undefined) {
    throw new DiagnosticError('unknown_item', `no diagnostic item "${answer.itemId}"`)
  }
  if (state.usedItemIds.has(item.id)) {
    throw new DiagnosticError('item_already_answered', `item "${item.id}" was already answered`)
  }
  const own = state.estimates.get(item.moduleId)
  if (own === undefined || own.fixed !== null) {
    throw new DiagnosticError(
      'module_not_askable',
      `module "${item.moduleId}" is not part of this diagnostic`,
    )
  }

  const estimates = new Map(state.estimates)
  let misconceptions = state.misconceptions

  if (answer.outcome === 'skipped') {
    // A skip spends the slot and the concept, and says nothing about θ.
    estimates.set(item.moduleId, {
      ...own,
      served: own.served + 1,
      evidence: [
        ...own.evidence,
        {
          kind: 'answer',
          itemId: item.id,
          outcome: 'skipped',
          confidence: answer.confidence,
          delta: 0,
        },
      ],
    })
  } else {
    const correct = answer.outcome === 'correct'
    const delta = thetaDelta({
      theta: own.theta,
      difficulty: answer.difficulty,
      answered: own.answered,
      correct,
      confidence: answer.confidence,
    })
    estimates.set(item.moduleId, {
      ...own,
      theta: own.theta + delta,
      answered: own.answered + 1,
      served: own.served + 1,
      sureApplyCorrect:
        own.sureApplyCorrect ||
        (correct && answer.confidence === 'sure' && isApplyOrAbove(item.bloom)),
      evidence: [
        ...own.evidence,
        {
          kind: 'answer',
          itemId: item.id,
          outcome: answer.outcome,
          confidence: answer.confidence,
          delta,
        },
      ],
    })
    for (const target of propagationTargets(
      state.config.graph,
      item.moduleId,
      delta,
      state.tuning.hopFactors,
    )) {
      const estimate = estimates.get(target.moduleId)
      if (estimate === undefined || estimate.fixed !== null) continue
      estimates.set(target.moduleId, {
        ...estimate,
        theta: estimate.theta + target.delta,
        inferred: estimate.inferred + 1,
        evidence: [
          ...estimate.evidence,
          { kind: 'inferred', fromModuleId: item.moduleId, delta: target.delta },
        ],
      })
    }
    if (!correct && answer.confidence === 'sure') {
      const chosen = answer.chosenOptionId
      misconceptions = [
        ...misconceptions,
        {
          moduleId: item.moduleId,
          itemId: item.id,
          conceptIds: [...item.conceptIds],
          misconceptionId: chosen === null ? null : (item.misconceptionByOption[chosen] ?? null),
        },
      ]
    }
  }

  return {
    ...state,
    estimates,
    answers: [...state.answers, answer],
    usedItemIds: new Set([...state.usedItemIds, item.id]),
    askedConceptIds: new Set([...state.askedConceptIds, ...item.conceptIds]),
    elapsedMs: state.elapsedMs + answer.timeMs,
    misconceptions,
  }
}

/** §10 step 3. Throws a `DiagnosticError` once the diagnostic has stopped. */
export function answerItem(state: DiagnosticState, answer: DiagnosticAnswer): DiagnosticState {
  const reason = stopReason(state)
  if (reason !== null) {
    throw new DiagnosticError('diagnostic_stopped', `the diagnostic has stopped (${reason})`)
  }
  return applyAnswer(state, answer)
}

/**
 * The state after `answers`, as an uninterrupted run reached it.
 *
 * No stop check: a log the engine wrote is by construction within the limits, and refusing
 * to fold it because a later version of the limits says otherwise would strand a session the
 * learner was halfway through.
 */
export function replayDiagnostic(
  config: DiagnosticConfig,
  answers: readonly DiagnosticAnswer[],
  tuning: DiagnosticTuning = DEFAULT_TUNING,
): DiagnosticState {
  return answers.reduce(applyAnswer, startDiagnostic(config, tuning))
}

/** "Terminar ahora": the diagnostic stops with what it has (§10 step 7, "abandonment"). */
export function abandonDiagnostic(state: DiagnosticState): DiagnosticState {
  return { ...state, abandoned: true }
}

/**
 * "Quedan ~N" for the progress bar: two more items for a module never asked, one for one
 * already asked, capped by the items left under the ceiling. An estimate — the bar says "~".
 */
export function remainingEstimate(state: DiagnosticState): number {
  if (stopReason(state) !== null) return 0
  let needed = 0
  for (const module of askableModules(state)) {
    const estimate = state.estimates.get(module.id) as ModuleEstimate
    needed += Math.min(
      DIAGNOSTIC_LIMITS.maxPerModule - estimate.served,
      estimate.answered === 0 ? 2 : 1,
    )
  }
  return Math.max(1, Math.min(DIAGNOSTIC_LIMITS.maxItems - state.answers.length, needed))
}
