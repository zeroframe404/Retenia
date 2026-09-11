import { describe, expect, it } from 'vitest'
import {
  BATCH_MINUTES,
  EXPANSION_BATCH_WAVES,
  estimateGeneration,
  estimateWarnings,
  expectedConcepts,
  expectedModules,
  FAMILIES_PER_LESSON,
  LESSONS_PER_MODULE,
  MODULE_OUTPUT_TOKENS,
  MODULE_TASK_TOKENS,
  P1_OUTPUT_TOKENS_PER_CHUNK,
  P3_CACHED_PREFIX_TOKENS,
  P6_INPUT_TOKENS_PER_LESSON,
  P6_OUTPUT_TOKENS,
  P8_SHARE,
  QA_BATCH_WAVES,
  REGENERATE_SHARE,
} from './estimate-generation'

const cheap = {
  inputUsdPerMillion: 1,
  outputUsdPerMillion: 5,
  cachedInputUsdPerMillion: 0.1,
  cacheWriteUsdPerMillion: 1.25,
}
const smart = {
  inputUsdPerMillion: 2,
  outputUsdPerMillion: 10,
  cachedInputUsdPerMillion: 0.2,
  cacheWriteUsdPerMillion: 2.5,
}
const judge = {
  inputUsdPerMillion: 0.75,
  outputUsdPerMillion: 3.75,
}

function chunks(count: number, tokens = 400) {
  return Array.from({ length: count }, () => ({
    text: 'x'.repeat(tokens * 4),
    context: null,
    tokenCount: tokens,
  }))
}

const systemTokens = {
  extract: 1000,
  outline: 1500,
  module: 1200,
  lesson: 1800,
  activities: 1600,
  flashcards: 1400,
  faithfulness: 1300,
  judge: 1500,
  edit: 1200,
}

describe('estimateWarnings()', () => {
  it('reports an unpriced role only when there is a cap to enforce', () => {
    expect(estimateWarnings({ priced: { cheap: false, smart: true, judge: true } }, 0)).toEqual([])
    expect(estimateWarnings({ priced: { cheap: true, smart: true, judge: true } }, 5)).toEqual([])
    expect(estimateWarnings({ priced: { cheap: false, smart: false, judge: false } }, 5)).toEqual([
      { code: 'estimate_unpriced', stage: 'extract', params: { role: 'cheap' } },
      { code: 'estimate_unpriced', stage: 'extract', params: { role: 'smart' } },
      { code: 'estimate_unpriced', stage: 'extract', params: { role: 'judge' } },
    ])
  })

  it('does not report the judge on a light run, which never calls it', () => {
    expect(
      estimateWarnings({ priced: { cheap: true, smart: true, judge: false } }, 5, 'light'),
    ).toEqual([])
    expect(
      estimateWarnings({ priced: { cheap: true, smart: true, judge: false } }, 5, 'full'),
    ).toEqual([{ code: 'estimate_unpriced', stage: 'extract', params: { role: 'judge' } }])
  })
})

describe('expectedConcepts() and expectedModules()', () => {
  it('follow §13’s 180 chunks → 212 concepts, clamped at the bottom', () => {
    expect(expectedConcepts(180)).toBe(216)
    expect(expectedConcepts(2)).toBe(8)
    expect(expectedModules(216)).toBe(27)
    expect(expectedModules(8)).toBe(2)
    expect(expectedModules(10_000)).toBe(40)
  })
})

describe('estimateGeneration()', () => {
  it('prices P1 per remaining chunk and P2 as one uncached outline plus cached module calls', () => {
    const estimate = estimateGeneration({
      chunks: chunks(10),
      alreadyExtracted: 4,
      rates: { cheap, smart, judge },
      systemTokens,
      dispatch: 'sync',
    })
    expect(estimate).toMatchObject({
      chunks: 10,
      concepts: 12,
      modules: 2,
      dispatch: 'sync',
      priced: { cheap: true, smart: true, judge: true },
    })
    // P1: 6 calls × (1000 + 400 + 120) in, 6 × 500 out.
    expect(estimate.p1).toEqual({
      calls: 6,
      inputTokens: 6 * 1520,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 6 * P1_OUTPUT_TOKENS_PER_CHUNK,
      usd: (6 * 1520 * 1 + 3000 * 5) / 1e6,
    })
    // The prefix: 12 × 10 + 45 × 12 = 660 tokens.
    expect(estimate.p2Outline).toEqual({
      calls: 1,
      inputTokens: 1500 + 660 + 300,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: Math.round(25 * 12 * 1.3) + 1500,
      usd: ((1500 + 660 + 300) * 2 + (Math.round(25 * 12 * 1.3) + 1500) * 10) / 1e6,
    })
    expect(estimate.p2Modules).toEqual({
      calls: 2,
      inputTokens: 2 * MODULE_TASK_TOKENS,
      cachedInputTokens: 1200 + 660,
      cacheWriteTokens: 1200 + 660,
      outputTokens: 2 * MODULE_OUTPUT_TOKENS,
      usd:
        (2 * MODULE_TASK_TOKENS * 2 +
          (1200 + 660) * 0.2 +
          (1200 + 660) * 2.5 +
          2 * MODULE_OUTPUT_TOKENS * 10) /
        1e6,
    })
    // The quote covers every stage the run will be billed for, stage 7 included: §6's table
    // for a 300-page book puts the lessons row at 1.18 of a 3.4 total, so a quote that
    // stopped at P2 would understate the bill by most of it.
    const expand =
      estimate.p3Lessons.usd +
      estimate.p4Activities.usd +
      estimate.p5Flashcards.usd +
      estimate.p6Faithfulness.usd +
      estimate.p7Judge.usd +
      estimate.p8Edit.usd +
      estimate.qaRegenerate.usd
    expect(expand).toBeGreaterThan(0)
    expect(estimate.usd).toBeCloseTo(
      estimate.p1.usd + estimate.p2Outline.usd + estimate.p2Modules.usd + expand,
      6,
    )
    const guessed = estimate.p2Outline.usd + estimate.p2Modules.usd + expand
    expect(estimate.lowUsd).toBeCloseTo(estimate.p1.usd * 0.9 + guessed * 0.7, 6)
    expect(estimate.highUsd).toBeCloseTo(estimate.p1.usd * 1.1 + guessed * 1.3, 6)
  })

  it('quotes stage 7 per lesson, over a path-wide cached head', () => {
    const estimate = estimateGeneration({
      chunks: chunks(6),
      alreadyExtracted: 0,
      rates: { cheap, smart },
      systemTokens,
      dispatch: 'sync',
    })

    expect(estimate.lessons).toBe(estimate.modules * LESSONS_PER_MODULE)
    // One P3 call per lesson, one P4 call per family per lesson, one P5 call per lesson.
    expect(estimate.p3Lessons.calls).toBe(estimate.lessons)
    expect(estimate.p4Activities.calls).toBe(estimate.lessons * FAMILIES_PER_LESSON)
    expect(estimate.p5Flashcards.calls).toBe(estimate.lessons)
    // The head is written once and read by every lesson after it (§6: "5k cached").
    expect(estimate.p3Lessons.cacheWriteTokens).toBe(systemTokens.lesson + P3_CACHED_PREFIX_TOKENS)
    expect(estimate.p3Lessons.cachedInputTokens).toBe(
      (systemTokens.lesson + P3_CACHED_PREFIX_TOKENS) * (estimate.lessons - 1),
    )
    // P4 and P5 read the theory in their task, not a shared prefix, so they cache nothing.
    expect(estimate.p4Activities.cachedInputTokens).toBe(0)
    expect(estimate.p5Flashcards.cachedInputTokens).toBe(0)
  })

  it('halves P1 on the batch path and quotes the batch’s latency instead of the pool’s', () => {
    const sync = estimateGeneration({
      chunks: chunks(10),
      alreadyExtracted: 0,
      rates: { cheap, smart },
      systemTokens,
      dispatch: 'sync',
    })
    const batch = estimateGeneration({
      chunks: chunks(10),
      alreadyExtracted: 0,
      rates: { cheap, smart },
      systemTokens,
      dispatch: 'batch',
    })
    expect(batch.p1.usd).toBeCloseTo(sync.p1.usd / 2, 9)
    expect(batch.p2Outline).toEqual(sync.p2Outline)
    // Stages 7 and 8 are batched too: the tail is three sequential expansion waves — theory,
    // practice, cards — and then the QA waves, so the wait is that many Batch API windows,
    // not one.
    expect(batch.p3Lessons.usd).toBeCloseTo(sync.p3Lessons.usd / 2, 9)
    const windows = 1 + EXPANSION_BATCH_WAVES + QA_BATCH_WAVES.full
    expect(batch.minutes.high - batch.minutes.low).toBe(
      (BATCH_MINUTES.high - BATCH_MINUTES.low) * windows,
    )
    expect(batch.minutes.low).toBeGreaterThanOrEqual(BATCH_MINUTES.low * windows)
    const none = estimateGeneration({
      chunks: chunks(10),
      alreadyExtracted: 0,
      rates: { cheap, smart },
      systemTokens,
      dispatch: 'batch',
      batchDiscount: 0,
    })
    expect(none.p1.usd).toBe(sync.p1.usd)
  })

  it('counts a chunk without a token count, and the context, through the counter', () => {
    const estimate = estimateGeneration({
      chunks: [{ text: 'abcd'.repeat(50), context: 'ctx'.repeat(20), tokenCount: 0 }],
      alreadyExtracted: 0,
      rates: { cheap },
      systemTokens,
      dispatch: 'sync',
      countTokens: (text) => text.length,
    })
    expect(estimate.p1.inputTokens).toBe(1000 + 200 + 60 + 120)
    expect(estimate.priced).toEqual({ cheap: true, smart: false, judge: false })
    expect(estimate.p2Outline.usd).toBe(0)
    expect(estimate.p2Modules.usd).toBe(0)
  })

  it('quotes nothing for nothing, and only P2 when everything is already extracted', () => {
    const empty = estimateGeneration({
      chunks: [],
      alreadyExtracted: 0,
      rates: {},
      systemTokens,
      dispatch: 'batch',
    })
    expect(empty).toMatchObject({
      chunks: 0,
      usd: 0,
      lowUsd: 0,
      highUsd: 0,
      minutes: { low: 0, high: 0 },
    })
    expect(empty.p1.calls).toBe(0)
    expect(empty.p2Outline.calls).toBe(0)
    expect(empty.p2Modules.calls).toBe(0)
    expect(empty.lessons).toBe(0)
    expect(empty.p3Lessons.calls).toBe(0)
    expect(empty.p4Activities.calls).toBe(0)
    expect(empty.p5Flashcards.calls).toBe(0)
    expect(empty.p6Faithfulness.calls).toBe(0)
    expect(empty.p7Judge.calls).toBe(0)
    expect(empty.p8Edit.calls).toBe(0)
    expect(empty.qaRegenerate.calls).toBe(0)

    const done = estimateGeneration({
      chunks: chunks(3),
      alreadyExtracted: 3,
      rates: { cheap, smart },
      systemTokens,
      dispatch: 'batch',
    })
    expect(done.p1.calls).toBe(0)
    expect(done.p1.usd).toBe(0)
    expect(done.p2Outline.calls).toBe(1)
    // No P1 calls, but stages 7 and 8 still have a tail to batch, so there is still a wait —
    // the expansion and QA windows, without P1's.
    expect(done.p3Lessons.calls).toBeGreaterThan(0)
    expect(done.minutes.high - done.minutes.low).toBe(
      (BATCH_MINUTES.high - BATCH_MINUTES.low) * (EXPANSION_BATCH_WAVES + QA_BATCH_WAVES.full),
    )
  })

  it('falls back to the input rate when a rate card has no cache prices', () => {
    const bare = { inputUsdPerMillion: 2, outputUsdPerMillion: 10 }
    const estimate = estimateGeneration({
      chunks: chunks(4),
      alreadyExtracted: 0,
      rates: { smart: bare },
      systemTokens,
      dispatch: 'sync',
      concurrency: { extract: 1, modules: 1 },
    })
    const tokens = estimate.p2Modules
    expect(tokens.usd).toBeCloseTo(
      ((tokens.inputTokens + tokens.cachedInputTokens + tokens.cacheWriteTokens) * 2 +
        tokens.outputTokens * 10) /
        1e6,
      9,
    )
  })
})

describe('stage 8 rows (sub-phase 8.4)', () => {
  const full = estimateGeneration({
    chunks: chunks(6),
    alreadyExtracted: 0,
    rates: { cheap, smart, judge },
    systemTokens,
    dispatch: 'sync',
  })

  it('prices P6 on the cheap role, once per lesson, at §6’s 8.5k / 1k', () => {
    expect(full.p6Faithfulness.calls).toBe(full.lessons)
    expect(full.p6Faithfulness.inputTokens).toBe(
      full.lessons * (systemTokens.faithfulness + P6_INPUT_TOKENS_PER_LESSON),
    )
    expect(full.p6Faithfulness.outputTokens).toBe(full.lessons * P6_OUTPUT_TOKENS)
    expect(full.p6Faithfulness.usd).toBeCloseTo(
      (full.p6Faithfulness.inputTokens * cheap.inputUsdPerMillion +
        full.p6Faithfulness.outputTokens * cheap.outputUsdPerMillion) /
        1e6,
      9,
    )
  })

  it('prices the judge on its own role and the editor on a share of the lessons', () => {
    expect(full.p7Judge.calls).toBe(full.lessons)
    expect(full.p7Judge.usd).toBeCloseTo(
      (full.p7Judge.inputTokens * judge.inputUsdPerMillion +
        full.p7Judge.outputTokens * judge.outputUsdPerMillion) /
        1e6,
      9,
    )
    expect(full.p8Edit.calls).toBe(Math.round(full.lessons * P8_SHARE))
    expect(full.qaRegenerate.calls).toBe(Math.round(full.lessons * REGENERATE_SHARE))
    // A regeneration costs what writing the lesson cost: P3 + P4 + P5, per lesson.
    expect(full.qaRegenerate.usd).toBeCloseTo(
      (full.p3Lessons.usd + full.p4Activities.usd + full.p5Flashcards.usd) * REGENERATE_SHARE,
      6,
    )
    expect(full.usd).toBeGreaterThan(
      full.p1.usd + full.p2Outline.usd + full.p2Modules.usd + full.p3Lessons.usd,
    )
  })

  it('zeroes the judge and the editor in light mode, and keeps the verifier', () => {
    const light = estimateGeneration({
      chunks: chunks(6),
      alreadyExtracted: 0,
      rates: { cheap, smart, judge },
      systemTokens,
      dispatch: 'batch',
      qaMode: 'light',
    })
    expect(light.p6Faithfulness.calls).toBe(light.lessons)
    expect(light.p7Judge.calls).toBe(0)
    expect(light.p7Judge.usd).toBe(0)
    expect(light.p8Edit.calls).toBe(0)
    expect(light.usd).toBeLessThan(full.usd)
    // One QA window instead of four: P6 alone.
    const fullBatch = estimateGeneration({
      chunks: chunks(6),
      alreadyExtracted: 0,
      rates: { cheap, smart, judge },
      systemTokens,
      dispatch: 'batch',
    })
    expect(fullBatch.minutes.low - light.minutes.low).toBeGreaterThanOrEqual(
      BATCH_MINUTES.low * (QA_BATCH_WAVES.full - QA_BATCH_WAVES.light),
    )
  })

  it('prices an unpriced judge at zero and says so through priced.judge', () => {
    const noJudge = estimateGeneration({
      chunks: chunks(6),
      alreadyExtracted: 0,
      rates: { cheap, smart },
      systemTokens,
      dispatch: 'sync',
    })
    expect(noJudge.p7Judge.calls).toBe(noJudge.lessons)
    expect(noJudge.p7Judge.usd).toBe(0)
    expect(noJudge.priced.judge).toBe(false)
  })
})
