import type { BloomLevel, ConfidenceLevel } from '@retenia/core'

/**
 * The prior-knowledge diagnostic of `docs/spec/04-path-generation.md` §10 (figure 7.1):
 * "outline-driven adaptive quiz", an Elo-lite estimate per module with propagation through
 * the prerequisite DAG. Everything in this folder is pure — no clock, no repository, no
 * model — so a diagnostic is a function of its configuration and its answer log, which is
 * what makes it resumable by replay.
 */

/** §10 step 1: the four self-assessment levels, per section. `never` is never asked. */
export const SELF_ASSESSMENT_LEVELS = ['never', 'familiar', 'know', 'master'] as const
export type SelfAssessmentLevel = (typeof SELF_ASSESSMENT_LEVELS)[number]

/** §10 step 1: "desde cero" (everything unknown, nothing asked) or "ya sé parte". */
export const DIAGNOSTIC_ENTRIES = ['scratch', 'partial'] as const
export type DiagnosticEntry = (typeof DIAGNOSTIC_ENTRIES)[number]

/** §10 step 6. */
export const MODULE_STATUSES = ['known', 'partial', 'unknown'] as const
export type ModuleStatus = (typeof MODULE_STATUSES)[number]

/**
 * §10 step 7, plus the two ways a diagnostic ends that the spec's list implies: `from_scratch`
 * (nothing was ever going to be asked) and `no_items` (modules are still open but the bank has
 * nothing left for them that would not repeat a concept).
 */
export const STOP_REASONS = [
  'from_scratch',
  'all_classified',
  'no_items',
  'max_items',
  'time_limit',
  'abandoned',
] as const
export type StopReason = (typeof STOP_REASONS)[number]

export const ANSWER_OUTCOMES = ['correct', 'wrong', 'skipped'] as const
export type AnswerOutcome = (typeof ANSWER_OUTCOMES)[number]

/**
 * Where a module's status came from: the diagnostic's own evidence, the self-assessment
 * ("nunca lo vi"), the "desde cero" entry, the preview's "ya lo sé" (`self_declared`), or
 * nothing at all (`unevidenced` — a module the diagnostic never reached).
 */
export const STATUS_SOURCES = [
  'diagnostic',
  'never_seen',
  'from_scratch',
  'self_declared',
  'unevidenced',
] as const
export type StatusSource = (typeof STATUS_SOURCES)[number]

export interface DiagnosticModule {
  readonly id: string
  readonly sectionId: string
  /** Position in the path, section order then module order: the last tie-breaker everywhere. */
  readonly ordinal: number
  /** Mean importance of the module's concepts, 0–1. */
  readonly importance: number
  readonly conceptIds: readonly string[]
}

/** The module-level prerequisite DAG, lifted from the concept graph (`module-graph.ts`). */
export interface ModuleGraph {
  readonly modules: readonly DiagnosticModule[]
  /** Direct prerequisites of each module, by ordinal. */
  readonly parents: ReadonlyMap<string, readonly string[]>
  /** Direct dependents of each module, by ordinal. */
  readonly children: ReadonlyMap<string, readonly string[]>
  /** Longest path from a root: roots are 0. */
  readonly depth: ReadonlyMap<string, number>
}

/** One `item_bank` entry tagged `diagnostic`, as much of it as the engine reads. */
export interface DiagnosticItem {
  /** The `item_bank` id. */
  readonly id: string
  readonly moduleId: string
  readonly conceptIds: readonly string[]
  /** `difficulty_logit` now: what selection matches against θ. */
  readonly difficultyLogit: number
  readonly bloom: BloomLevel | null
  /** Times shown so far — the least-exposed wins a tie. */
  readonly exposure: number
  /** The misconception each distractor was built from, by option id. */
  readonly misconceptionByOption: Readonly<Record<string, string>>
}

/**
 * One answer, as persisted. `difficulty` is the logit the item had *when it was served*:
 * the bank's value moves with the item's own Elo update, and a replay that read today's value
 * would not reproduce yesterday's θ.
 */
export interface DiagnosticAnswer {
  readonly itemId: string
  readonly outcome: AnswerOutcome
  readonly confidence: ConfidenceLevel | null
  readonly timeMs: number
  readonly difficulty: number
  readonly chosenOptionId: string | null
}

export interface DiagnosticConfig {
  readonly graph: ModuleGraph
  readonly items: readonly DiagnosticItem[]
  readonly entry: DiagnosticEntry
  /** Per section id. A section without an entry reads as `familiar`; ignored for `scratch`. */
  readonly selfAssessment: Readonly<Record<string, SelfAssessmentLevel>>
  /** Modules the preview already marked "ya lo sé": known, never asked, no actions. */
  readonly selfDeclaredKnown?: readonly string[]
}

/**
 * The knobs §10 leaves open. Everything the spec fixes — the confidence weights, `K(n)`, the
 * 0.5 propagation over two levels, the 0.8/0.4 thresholds, 3 items per module, 25–30 items,
 * 12–15 minutes — is a constant elsewhere and not tunable here.
 */
export interface DiagnosticTuning {
  /** θ₀ per self-assessment level (§10 names the levels, not their priors). */
  readonly priors: Readonly<Record<Exclude<SelfAssessmentLevel, 'never'>, number>>
  /**
   * Share of Δθ that reaches a module one and two hops away. §10 step 4: "+0.5·Δθ … maximum
   * two levels", with no decay between the levels — so 0.5 at both.
   */
  readonly hopFactors: readonly [number, number]
  /** "The most uncertain module weighted by importance": `(bias + importance) · 4P(1−P)`. */
  readonly importanceBias: number
}

export const DEFAULT_TUNING: DiagnosticTuning = Object.freeze({
  priors: Object.freeze({ familiar: -0.4, know: 0.4, master: 1.2 }),
  hopFactors: Object.freeze([0.5, 0.5]) as readonly [number, number],
  importanceBias: 0.5,
})

/** §10 steps 5 and 7. */
export const DIAGNOSTIC_LIMITS = Object.freeze({
  /** The hard ceiling: the diagnostic never exceeds it. */
  maxItems: 30,
  /** Past this, only an unsettled important module keeps it going. */
  softMaxItems: 25,
  maxPerModule: 3,
  softTimeMs: 12 * 60_000,
  hardTimeMs: 15 * 60_000,
  /** "Important" for the soft stops: the coverage gate's threshold (§5 gate 4). */
  importantModule: 0.5,
})

/** §10 step 6. */
export const CLASSIFICATION = Object.freeze({
  known: 0.8,
  unknown: 0.4,
  knownMinAnswers: 2,
})
