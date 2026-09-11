import type { PerMillionRates, TokenCounter } from '@retenia/ai'
import { approximateTokens } from '@retenia/ai'
import type { Chunk } from '@retenia/core'
import { SYNCHRONOUS_HEAD_LESSONS } from '../expand/expand-lessons'
import { FIXED_CELLS_PER_MODULE } from '../item-bank/blueprint'
import type { QaMode } from '../qa/lesson-qa'
import { type GenerationWarning, warning } from '../schemas/warnings'
import { OUTLINE_MAX_OUTPUT_TOKENS } from '../synthesize/tasks'

/**
 * The wizard's number before anything is sent (`docs/spec/04-path-generation.md` §13 step 1:
 * "live estimate of time and cost ('≈ 6 min and USD 3.40')"), as a pure function of the
 * chunks, the rate cards and a few assumptions the constants below make explicit.
 *
 * It is a band, not a figure: the input counts are `chars / 4` (±10 %), and the output
 * counts of P2 are guesses at what a graph and an outline weigh (±30 %). §6's table for a
 * 300-page book — 180 chunks, 220k in / 60k out for extraction, 80k / 20k for the synthesis —
 * is what the per-chunk and per-concept constants are fitted to. The batch path's exact
 * quote is the runner's own `estimate`, stored beside this one so the two can be compared.
 */

/** §6: 60k output tokens over 180 chunks, rounded up for a full answer. */
export const P1_OUTPUT_TOKENS_PER_CHUNK = 500
/** The identifiers, labels and instruction around the wrapped blocks. */
export const P1_TASK_OVERHEAD_TOKENS = 120
/** §13 step 2's "detecting 212 concepts" for a 180-chunk book. */
export const CONCEPTS_PER_CHUNK = 1.2
export const MIN_CONCEPTS = 8
export const CONCEPTS_PER_MODULE = 8
export const MIN_MODULES = 2
export const MAX_MODULES = 40
/** One heading line per chunk, roughly. */
export const TOC_TOKENS_PER_CHUNK = 12
export const OUTLINE_INPUT_TOKENS_PER_CONCEPT = 45
export const OUTLINE_TASK_TOKENS = 300
export const OUTLINE_OUTPUT_TOKENS_PER_CONCEPT = 25
export const OUTLINE_OUTPUT_BASE_TOKENS = 1_500
export const OUTLINE_OUTPUT_MARGIN = 1.3
export const MODULE_TASK_TOKENS = 1_500
export const MODULE_OUTPUT_TOKENS = 1_200
/**
 * Stage 7 (sub-phase 8.3), fitted to §6's lessons row: *"≈ 40 × 14k in, 5k cached / 4k out"*
 * for a 300-page book, which is 40 lessons over 8 modules.
 *
 * The wizard has to include these or its headline number is wrong by most of the bill: §6's
 * total for that book is USD 3.4 in batch and the lessons row alone is 1.18 of it. Before
 * this sub-phase the quote covered everything the app would actually spend; expansion is
 * what made that stop being true.
 */
export const LESSONS_PER_MODULE = 5
/** The lesson's own fragments and its spec — the 9k of §6's 14k that is not the cached head. */
export const P3_INPUT_TOKENS_PER_LESSON = 9_000
/** The path-wide head every lesson reads: few-shots, the table of contents, the glossary. */
export const P3_CACHED_PREFIX_TOKENS = 5_000
/** 600–1,200 words of Markdown with citations and a diagram. */
export const P3_OUTPUT_TOKENS = 4_000
/** One call per family, over the theory P3 just wrote. */
export const FAMILIES_PER_LESSON = 4
export const P4_INPUT_TOKENS_PER_FAMILY = 3_000
/** 2–3× the wanted count, of one family. */
export const P4_OUTPUT_TOKENS_PER_FAMILY = 2_500
export const P5_INPUT_TOKENS_PER_LESSON = 3_000
/** 3–8 cards with their cloze text and cues. */
export const P5_OUTPUT_TOKENS = 1_200
export const P3_SECONDS = 20
export const P4_SECONDS = 15
export const P5_SECONDS = 8
/**
 * The tail's batch windows: theory, then practice, then cards.
 *
 * Three rather than one because P4 and P5 both read the theory P3 wrote, and because the two
 * of them are dispatched one after the other rather than together — two waves spending from
 * one `BudgetGuard` could each clear the cap check before either had charged.
 */
export const EXPANSION_BATCH_WAVES = 3
/**
 * Stage 8 (sub-phase 8.4), fitted to §6's two QA rows for the same 40-lesson book:
 * *"Faithfulness + dedupe + variety: Haiku 4.5, 340k / 40k"* — 8.5k in, 1k out per lesson on
 * the cheap role — and *"Critic-editor on ≈ 30 % of lessons: Sonnet 5, 170k / 50k"* — 14k
 * in, 4k out per edited lesson. The judge has no row in §6 (its table predates gate 9 having
 * a model of its own); it reads the lesson and its spec and answers five rationales and up to
 * twelve edits, which is what the P7 figures size.
 */
export const P6_INPUT_TOKENS_PER_LESSON = 8_500
export const P6_OUTPUT_TOKENS = 1_000
export const P7_INPUT_TOKENS_PER_LESSON = 6_000
export const P7_OUTPUT_TOKENS = 1_200
/** §6: the critic-editor runs on about a third of the lessons. */
export const P8_SHARE = 0.3
export const P8_INPUT_TOKENS_PER_LESSON = 14_000
export const P8_OUTPUT_TOKENS = 4_000
/** Lessons the gates send back to P3 — at most once each; a tenth is the planning figure. */
export const REGENERATE_SHARE = 0.1
export const P6_SECONDS = 8
export const P7_SECONDS = 12
export const P8_SECONDS = 15
/**
 * The QA waves of the batched tail: P6, P7, P8 and the one P6 re-run after the edit —
 * sequential, for the same budget-guard reason the expansion waves are — in full mode, and
 * P6 alone in light mode.
 */
export const QA_BATCH_WAVES = Object.freeze({ full: 4, light: 1 })

/**
 * Stage 9 (sub-phase 8.5), fitted to §6's item-bank row for the same book: *"≈ 150 items:
 * diagnostic, reinforcements, exam A/B — Sonnet 5, 100k / 40k"*, i.e. 12.5k in and 5k out per
 * module, shared by the module's blueprint cells (one P9 call each): the
 * `FIXED_CELLS_PER_MODULE` every module gets — two diagnostic, one reinforcement — and about
 * three exam cells, one per difficulty band at the module's main Bloom level, which is what
 * `buildBlueprint` gives a module with a typical five exam items a form.
 *
 * The fixed cells are built at freeze, while the learner waits for the diagnostic: always
 * synchronous. The exam cells wait for the lessons and nobody waits for them, so they take the
 * batch rate whenever the run is batched.
 */
export const P9_INPUT_TOKENS_PER_MODULE = 12_500
export const P9_OUTPUT_TOKENS_PER_MODULE = 5_000
export const P9_EXAM_CELLS_PER_MODULE = 3
export const P9_CALLS_PER_MODULE = FIXED_CELLS_PER_MODULE + P9_EXAM_CELLS_PER_MODULE

export const P1_TOLERANCE = 0.1
export const P2_TOLERANCE = 0.3
/** `docs/spec/06-ai-providers.md` §2: the Batch API is −50 %. */
export const DEFAULT_BATCH_DISCOUNT = 0.5
export const SYNC_SECONDS_PER_CALL = 4
export const OUTLINE_SECONDS = 25
export const MODULE_SECONDS = 12
/** §14 pitfall 18: "most finish in under 1 h". */
export const BATCH_MINUTES = Object.freeze({ low: 10, high: 60 })

export type EstimateChunk = Pick<Chunk, 'text' | 'context' | 'tokenCount'>

export interface EstimateInput {
  /** In scope and not front matter — what extraction would read. */
  readonly chunks: readonly EstimateChunk[]
  /** Chunks whose extraction already exists; they cost nothing. */
  readonly alreadyExtracted: number
  readonly rates: {
    readonly cheap?: PerMillionRates
    readonly smart?: PerMillionRates
    /** The pedagogy judge's model — a different one from `smart` by rule (§5 gate 9). */
    readonly judge?: PerMillionRates
  }
  /** Tokens of each prompt's system message, output instruction included. */
  readonly systemTokens: {
    readonly extract: number
    readonly outline: number
    readonly module: number
    readonly lesson: number
    readonly activities: number
    readonly flashcards: number
    readonly faithfulness: number
    readonly judge: number
    readonly edit: number
    /** P9. Absent (an older caller) prices it at P4's system weight, its closest sibling. */
    readonly items?: number
  }
  /** Stage 8's depth. `light` prices no judge and no editor. Defaults to `full`. */
  readonly qaMode?: QaMode
  readonly dispatch: 'sync' | 'batch'
  /** The cheap model's Batch API discount, when `dispatch` is `batch`; `0` for a model without one. */
  readonly batchDiscount?: number
  readonly countTokens?: TokenCounter
  readonly concurrency?: { readonly extract: number; readonly modules: number }
}

export interface StageEstimate {
  readonly calls: number
  /** Uncached prompt tokens — what `ai_calls.input_tokens` means. */
  readonly inputTokens: number
  readonly cachedInputTokens: number
  readonly cacheWriteTokens: number
  readonly outputTokens: number
  readonly usd: number
}

export interface GenerationEstimate {
  readonly chunks: number
  readonly concepts: number
  readonly modules: number
  /** Expected lessons — what stage 7 will be billed for, at `LESSONS_PER_MODULE` a module. */
  readonly lessons: number
  readonly p1: StageEstimate
  readonly p2Outline: StageEstimate
  readonly p2Modules: StageEstimate
  readonly p3Lessons: StageEstimate
  readonly p4Activities: StageEstimate
  readonly p5Flashcards: StageEstimate
  /** Stage 8 (sub-phase 8.4): the verifier, the judge, the editor and the regenerations. */
  readonly p6Faithfulness: StageEstimate
  readonly p7Judge: StageEstimate
  readonly p8Edit: StageEstimate
  readonly qaRegenerate: StageEstimate
  /** Stage 9 (sub-phase 8.5): the item bank's P9 calls, one per blueprint cell. */
  readonly p9Items: StageEstimate
  /** The midpoint; `lowUsd`/`highUsd` are the band the wizard should render. */
  readonly usd: number
  readonly lowUsd: number
  readonly highUsd: number
  readonly minutes: { readonly low: number; readonly high: number }
  readonly dispatch: 'sync' | 'batch'
  /** Whether each role could be priced; an unpriced role contributes 0 and the wizard says so. */
  readonly priced: { readonly cheap: boolean; readonly smart: boolean; readonly judge: boolean }
}

const PER_MILLION = 1_000_000

const ZERO_STAGE: StageEstimate = Object.freeze({
  calls: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  usd: 0,
})

function round(usd: number): number {
  return Math.round(usd * 1e6) / 1e6
}

function priceOf(
  rates: PerMillionRates | undefined,
  tokens: Pick<
    StageEstimate,
    'inputTokens' | 'cachedInputTokens' | 'cacheWriteTokens' | 'outputTokens'
  >,
  multiplier = 1,
): number {
  if (rates === undefined) return 0
  const cached = rates.cachedInputUsdPerMillion ?? rates.inputUsdPerMillion
  const write = rates.cacheWriteUsdPerMillion ?? rates.inputUsdPerMillion
  return round(
    ((tokens.inputTokens * rates.inputUsdPerMillion +
      tokens.cachedInputTokens * cached +
      tokens.cacheWriteTokens * write +
      tokens.outputTokens * rates.outputUsdPerMillion) /
      PER_MILLION) *
      multiplier,
  )
}

/**
 * A run with a cap whose roles cannot be priced has a cap that cannot be enforced: the
 * quote is 0 and so is every recorded cost. Said once, up front, rather than discovered
 * from a bill.
 */
export function estimateWarnings(
  estimate: Pick<GenerationEstimate, 'priced'>,
  budgetCapUsd: number,
  qaMode: QaMode = 'full',
): GenerationWarning[] {
  if (budgetCapUsd <= 0) return []
  const out: GenerationWarning[] = []
  if (!estimate.priced.cheap) out.push(warning('estimate_unpriced', { role: 'cheap' }))
  if (!estimate.priced.smart) out.push(warning('estimate_unpriced', { role: 'smart' }))
  // The judge only spends in full mode; an unpriced judge on a light run enforces nothing.
  if (qaMode === 'full' && !estimate.priced.judge) {
    out.push(warning('estimate_unpriced', { role: 'judge' }))
  }
  return out
}

export function expectedConcepts(chunks: number): number {
  return Math.max(MIN_CONCEPTS, Math.round(CONCEPTS_PER_CHUNK * chunks))
}

export function expectedModules(concepts: number): number {
  return Math.min(MAX_MODULES, Math.max(MIN_MODULES, Math.round(concepts / CONCEPTS_PER_MODULE)))
}

/** §3 stage 5: *"module = 3–7 lessons"*. */
export function expectedLessons(modules: number): number {
  return modules * LESSONS_PER_MODULE
}

export function estimateGeneration(input: EstimateInput): GenerationEstimate {
  const count = input.countTokens ?? approximateTokens
  const concurrency = input.concurrency ?? { extract: 6, modules: 3 }
  const chunks = input.chunks.length
  const concepts = expectedConcepts(chunks)
  const modules = expectedModules(concepts)

  // P1 — one call per chunk not yet extracted, at the average chunk weight.
  const calls = Math.max(0, chunks - input.alreadyExtracted)
  const chunkTokens = input.chunks.reduce(
    (sum, chunk) =>
      sum +
      (chunk.tokenCount > 0 ? chunk.tokenCount : count(chunk.text)) +
      (chunk.context === null ? 0 : count(chunk.context)),
    0,
  )
  const averageChunk = chunks === 0 ? 0 : chunkTokens / chunks
  const discount = input.dispatch === 'batch' ? (input.batchDiscount ?? DEFAULT_BATCH_DISCOUNT) : 0
  const p1Tokens = {
    inputTokens: Math.round(
      calls * (input.systemTokens.extract + averageChunk + P1_TASK_OVERHEAD_TOKENS),
    ),
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: calls * P1_OUTPUT_TOKENS_PER_CHUNK,
  }
  const p1: StageEstimate =
    calls === 0
      ? ZERO_STAGE
      : { calls, ...p1Tokens, usd: priceOf(input.rates.cheap, p1Tokens, 1 - discount) }

  // P2 — the outline reads the TOC and the concept list once; the modules read them cached.
  const prefix = TOC_TOKENS_PER_CHUNK * chunks + OUTLINE_INPUT_TOKENS_PER_CONCEPT * concepts
  const outlineTokens = {
    inputTokens: input.systemTokens.outline + prefix + OUTLINE_TASK_TOKENS,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: Math.min(
      OUTLINE_MAX_OUTPUT_TOKENS,
      Math.round(OUTLINE_OUTPUT_TOKENS_PER_CONCEPT * concepts * OUTLINE_OUTPUT_MARGIN) +
        OUTLINE_OUTPUT_BASE_TOKENS,
    ),
  }
  const p2Outline: StageEstimate =
    chunks === 0
      ? ZERO_STAGE
      : { calls: 1, ...outlineTokens, usd: priceOf(input.rates.smart, outlineTokens) }

  const modulePrefix = input.systemTokens.module + prefix
  const moduleTokens = {
    inputTokens: modules * MODULE_TASK_TOKENS,
    cachedInputTokens: modulePrefix * (modules - 1),
    cacheWriteTokens: modulePrefix,
    outputTokens: modules * MODULE_OUTPUT_TOKENS,
  }
  const p2Modules: StageEstimate =
    chunks === 0
      ? ZERO_STAGE
      : { calls: modules, ...moduleTokens, usd: priceOf(input.rates.smart, moduleTokens) }

  // P3, P4 and P5 — stage 7, one lesson at a time over a path-wide cached head.
  const lessons = chunks === 0 ? 0 : expectedLessons(modules)
  const lessonPrefix = input.systemTokens.lesson + P3_CACHED_PREFIX_TOKENS
  const p3Tokens = {
    inputTokens: lessons * P3_INPUT_TOKENS_PER_LESSON,
    cachedInputTokens: lessonPrefix * Math.max(0, lessons - 1),
    cacheWriteTokens: lessons === 0 ? 0 : lessonPrefix,
    outputTokens: lessons * P3_OUTPUT_TOKENS,
  }
  const p3Lessons: StageEstimate =
    lessons === 0
      ? ZERO_STAGE
      : {
          calls: lessons,
          ...p3Tokens,
          usd: priceOf(input.rates.smart, p3Tokens, 1 - discount),
        }

  const familyCalls = lessons * FAMILIES_PER_LESSON
  const p4Tokens = {
    inputTokens: familyCalls * (input.systemTokens.activities + P4_INPUT_TOKENS_PER_FAMILY),
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: familyCalls * P4_OUTPUT_TOKENS_PER_FAMILY,
  }
  const p4Activities: StageEstimate =
    lessons === 0
      ? ZERO_STAGE
      : {
          calls: familyCalls,
          ...p4Tokens,
          usd: priceOf(input.rates.smart, p4Tokens, 1 - discount),
        }

  const p5Tokens = {
    inputTokens: lessons * (input.systemTokens.flashcards + P5_INPUT_TOKENS_PER_LESSON),
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: lessons * P5_OUTPUT_TOKENS,
  }
  const p5Flashcards: StageEstimate =
    lessons === 0
      ? ZERO_STAGE
      : {
          calls: lessons,
          ...p5Tokens,
          usd: priceOf(input.rates.smart, p5Tokens, 1 - discount),
        }

  // Stage 8 — the gates that need a model (sub-phase 8.4). P6 on every lesson, P7 and P8
  // only in full mode, and the regenerations §5's thresholds send back to P3 priced at what
  // a lesson costs to write.
  const qaMode = input.qaMode ?? 'full'
  const p6Tokens = {
    inputTokens: lessons * (input.systemTokens.faithfulness + P6_INPUT_TOKENS_PER_LESSON),
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: lessons * P6_OUTPUT_TOKENS,
  }
  const p6Faithfulness: StageEstimate =
    lessons === 0
      ? ZERO_STAGE
      : { calls: lessons, ...p6Tokens, usd: priceOf(input.rates.cheap, p6Tokens, 1 - discount) }

  const judged = qaMode === 'full' ? lessons : 0
  const p7Tokens = {
    inputTokens: judged * (input.systemTokens.judge + P7_INPUT_TOKENS_PER_LESSON),
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: judged * P7_OUTPUT_TOKENS,
  }
  const p7Judge: StageEstimate =
    judged === 0
      ? ZERO_STAGE
      : { calls: judged, ...p7Tokens, usd: priceOf(input.rates.judge, p7Tokens, 1 - discount) }

  const edited = qaMode === 'full' ? Math.round(lessons * P8_SHARE) : 0
  const p8Tokens = {
    inputTokens: edited * (input.systemTokens.edit + P8_INPUT_TOKENS_PER_LESSON),
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: edited * P8_OUTPUT_TOKENS,
  }
  const p8Edit: StageEstimate =
    edited === 0
      ? ZERO_STAGE
      : { calls: edited, ...p8Tokens, usd: priceOf(input.rates.smart, p8Tokens, 1 - discount) }

  const regenerated = Math.round(lessons * REGENERATE_SHARE)
  const qaRegenerate: StageEstimate =
    regenerated === 0
      ? ZERO_STAGE
      : {
          calls: regenerated,
          inputTokens: Math.round(
            (p3Tokens.inputTokens + p4Tokens.inputTokens + p5Tokens.inputTokens) * REGENERATE_SHARE,
          ),
          cachedInputTokens: Math.round(p3Tokens.cachedInputTokens * REGENERATE_SHARE),
          cacheWriteTokens: 0,
          outputTokens: Math.round(
            (p3Tokens.outputTokens + p4Tokens.outputTokens + p5Tokens.outputTokens) *
              REGENERATE_SHARE,
          ),
          usd: round((p3Lessons.usd + p4Activities.usd + p5Flashcards.usd) * REGENERATE_SHARE),
        }

  // Stage 9 — the item bank (sub-phase 8.5): one P9 call per blueprint cell. The fixed cells
  // are synchronous; the exam's follow the run's dispatch.
  const p9System = input.systemTokens.items ?? input.systemTokens.activities
  const p9TokensOf = (calls: number) => ({
    inputTokens: Math.round(calls * (p9System + P9_INPUT_TOKENS_PER_MODULE / P9_CALLS_PER_MODULE)),
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: Math.round((calls * P9_OUTPUT_TOKENS_PER_MODULE) / P9_CALLS_PER_MODULE),
  })
  const p9Fixed = p9TokensOf(chunks === 0 ? 0 : modules * FIXED_CELLS_PER_MODULE)
  const p9Exam = p9TokensOf(chunks === 0 ? 0 : modules * P9_EXAM_CELLS_PER_MODULE)
  const cellCalls = chunks === 0 ? 0 : modules * P9_CALLS_PER_MODULE
  const p9Items: StageEstimate =
    cellCalls === 0
      ? ZERO_STAGE
      : {
          calls: cellCalls,
          inputTokens: p9Fixed.inputTokens + p9Exam.inputTokens,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: p9Fixed.outputTokens + p9Exam.outputTokens,
          usd: round(
            priceOf(input.rates.smart, p9Fixed) + priceOf(input.rates.smart, p9Exam, 1 - discount),
          ),
        }

  const p2Usd = p2Outline.usd + p2Modules.usd
  // Stages 7 to 9 share P2's tolerance: their token counts are the same kind of guess —
  // what a lesson or an item weighs before one has been written — rather than a measured
  // chunk length.
  const expandUsd =
    p3Lessons.usd +
    p4Activities.usd +
    p5Flashcards.usd +
    p6Faithfulness.usd +
    p7Judge.usd +
    p8Edit.usd +
    qaRegenerate.usd +
    p9Items.usd
  const usd = round(p1.usd + p2Usd + expandUsd)
  const lowUsd = round(p1.usd * (1 - P1_TOLERANCE) + (p2Usd + expandUsd) * (1 - P2_TOLERANCE))
  const highUsd = round(p1.usd * (1 + P1_TOLERANCE) + (p2Usd + expandUsd) * (1 + P2_TOLERANCE))

  const p2Seconds =
    chunks === 0
      ? 0
      : OUTLINE_SECONDS + (modules * MODULE_SECONDS) / Math.max(1, concurrency.modules)
  const p1Seconds = (calls * SYNC_SECONDS_PER_CALL) / Math.max(1, concurrency.extract)

  // Stages 7 and 8's clock. The head is a whole pipeline run synchronously whatever the
  // dispatch is (§3 stage 7's "2 lessons in real time"), gates included, so it is always
  // seconds the user waits; the tail is either the batch windows — three for the writing,
  // then the QA waves — or, when there is no runner, the rest of the lessons at the same
  // per-lesson cost.
  const qaSeconds = P6_SECONDS + (qaMode === 'full' ? P7_SECONDS + P8_SECONDS * P8_SHARE : 0)
  const perLessonSeconds = P3_SECONDS + P4_SECONDS + P5_SECONDS + qaSeconds
  const headLessons = Math.min(lessons, SYNCHRONOUS_HEAD_LESSONS)
  const tailLessons = Math.max(0, lessons - headLessons)
  const expandWaves = input.dispatch === 'batch' && tailLessons > 0 ? EXPANSION_BATCH_WAVES : 0
  const qaWaves = input.dispatch === 'batch' && tailLessons > 0 ? QA_BATCH_WAVES[qaMode] : 0
  const expandSeconds =
    (headLessons * perLessonSeconds) / Math.max(1, concurrency.modules) +
    (expandWaves > 0 ? 0 : tailLessons * perLessonSeconds)

  const syncSeconds = p1Seconds + p2Seconds + expandSeconds
  const windows = (calls > 0 ? 1 : 0) + expandWaves + qaWaves
  const minutes =
    input.dispatch === 'batch' && windows > 0
      ? {
          low: BATCH_MINUTES.low * windows + Math.ceil((p2Seconds + expandSeconds) / 60),
          high: BATCH_MINUTES.high * windows + Math.ceil((p2Seconds + expandSeconds) / 60),
        }
      : {
          low: Math.ceil(syncSeconds / 60),
          high: Math.ceil((2 * syncSeconds) / 60),
        }

  return {
    chunks,
    concepts,
    modules,
    lessons,
    p1,
    p2Outline,
    p2Modules,
    p3Lessons,
    p4Activities,
    p5Flashcards,
    p6Faithfulness,
    p7Judge,
    p8Edit,
    qaRegenerate,
    p9Items,
    usd,
    lowUsd,
    highUsd,
    minutes,
    dispatch: input.dispatch,
    priced: {
      cheap: input.rates.cheap !== undefined,
      smart: input.rates.smart !== undefined,
      judge: input.rates.judge !== undefined,
    },
  }
}
