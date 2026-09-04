import { describe, expect, it } from 'vitest'
import type { ReviewLog, SchedulerProfile } from '../entities'
import type { OptimizerTrainingResult } from '../ports/optimizer'
import { GLOBAL_SCHEDULER_SCOPE } from '../ports/scheduler-profile-repository'
import { fakeClock } from '../testing/in-memory-job-repository'
import { reviewLogFixture } from '../testing/memory-fixtures'
import {
  createApplyOptimization,
  createOptimizer,
  createOptimizerStatus,
  createPrepareOptimization,
  type OptimizerRepositories,
} from './optimizer'
import { OPTIMIZER_CSV_HEADER } from './optimizer-csv'
import { DEFAULT_FSRS_W } from './parameters'

const NOW = new Date('2026-09-04T12:00:00.000Z')

function profileFixture(overrides: Partial<SchedulerProfile> = {}): SchedulerProfile {
  return {
    id: '019a0000-0000-7000-8000-abcd00000001',
    scope: GLOBAL_SCHEDULER_SCOPE,
    algorithm: 'fsrs6',
    w: [...DEFAULT_FSRS_W],
    decay: DEFAULT_FSRS_W[20] as number,
    learningSteps: ['1m', '10m'],
    relearningSteps: ['10m'],
    enableFuzz: true,
    enableShortTerm: true,
    maximumInterval: 36_500,
    dayStartHour: 4,
    trainedAt: null,
    nReviews: null,
    logLoss: null,
    rmse: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    deviceId: 'test-device',
    version: 1,
    ...overrides,
  }
}

/** The two repositories the optimizer touches, and nothing else. */
function repos(options: { logs?: ReviewLog[]; profile?: SchedulerProfile } = {}) {
  let profile = options.profile ?? profileFixture()
  const logs = options.logs ?? []
  const saved: SchedulerProfile[] = []
  const store = {
    reviewLogs: {
      listSince: async () => logs,
      count: async (o?: { excludeManual?: boolean }) =>
        o?.excludeManual === true ? logs.filter((log) => log.rating !== 0).length : logs.length,
    },
    schedulerProfiles: {
      ensure: async () => profile,
      saveTrained: async (
        _scope: string,
        trained: Parameters<OptimizerRepositories['schedulerProfiles']['saveTrained']>[1],
      ) => {
        profile = {
          ...profile,
          w: [...trained.w],
          decay: trained.decay,
          trainedAt: trained.trainedAt,
          nReviews: trained.nReviews,
          logLoss: trained.logLoss,
          rmse: trained.rmse,
          version: profile.version + 1,
        }
        saved.push(profile)
        return profile
      },
    },
  } as unknown as OptimizerRepositories
  return { repos: store, saved, current: () => profile }
}

function trainingResult(overrides: Partial<OptimizerTrainingResult> = {}): OptimizerTrainingResult {
  const w = DEFAULT_FSRS_W.map((value, index) => (index === 0 ? value * 1.5 : value))
  return {
    w,
    decay: w[20] as number,
    before: { logLoss: 0.3461, rmse: 0.0712 },
    after: { logLoss: 0.3125, rmse: 0.0433 },
    nReviews: 5_000,
    nItems: 3_072,
    ...overrides,
  }
}

describe('§6/§16 — preparing a training set', () => {
  it('renders the history as fsrs-optimizer CSV and counts what it will train on', async () => {
    const cardId = '019a0000-0000-7000-8000-cccc00000001'
    const { repos: store } = repos({
      logs: [
        reviewLogFixture({ cardId, rating: 3, review: new Date('2026-01-01T10:00:00Z') }),
        reviewLogFixture({ cardId, rating: 1, review: new Date('2026-01-05T10:00:00Z') }),
        // A postpone: not an answer, so it is neither exported nor counted.
        reviewLogFixture({ cardId, rating: 0, review: new Date('2026-01-06T10:00:00Z') }),
      ],
    })

    const prepared = await createPrepareOptimization({ repos: store })()

    expect(prepared.csv.split('\n')[0]).toBe(OPTIMIZER_CSV_HEADER)
    expect(prepared.nReviews).toBe(2)
    expect(prepared.scope).toBe(GLOBAL_SCHEDULER_SCOPE)
    expect(prepared.profile.w).toEqual([...DEFAULT_FSRS_W])
  })

  it('counts nothing for an empty history', async () => {
    const { repos: store } = repos()
    expect((await createPrepareOptimization({ repos: store })()).nReviews).toBe(0)
  })
})

describe('§16 — the health check decides whether a model is kept', () => {
  it('stores parameters when the log loss improves', async () => {
    const { repos: store, saved } = repos()
    const apply = createApplyOptimization({ repos: store, clock: fakeClock(NOW.getTime()) })

    const outcome = await apply({ result: trainingResult(), confirm: true })

    expect(outcome.applied).toBe(true)
    expect(outcome.check.reason).toBe('improved')
    expect(outcome.check.logLossDelta).toBeCloseTo(0.0336, 6)
    expect(saved).toHaveLength(1)
    expect(saved[0]?.w[0]).toBeCloseTo((DEFAULT_FSRS_W[0] as number) * 1.5, 10)
    expect(saved[0]?.trainedAt).toEqual(NOW)
    expect(saved[0]?.nReviews).toBe(5_000)
    // The *new* model's quality is what §13 shows as "model quality".
    expect(saved[0]?.logLoss).toBeCloseTo(0.3125, 6)
  })

  it('rejects a worse model and writes nothing', async () => {
    const { repos: store, saved, current } = repos()
    const before = current()
    const apply = createApplyOptimization({ repos: store })

    const outcome = await apply({
      result: trainingResult({ after: { logLoss: 0.4, rmse: 0.02 } }),
      confirm: true,
    })

    expect(outcome.applied).toBe(false)
    expect(outcome.check.reason).toBe('log_loss_not_better')
    expect(saved).toHaveLength(0)
    expect(current()).toEqual(before)
  })

  /**
   * Re-training on unchanged history reproduces the same parameters, so the second run
   * scores exactly what the first did. That is the deterministic rejection path: equal is
   * not better, and rewriting the profile would restart §16's monthly clock for nothing.
   */
  it('rejects a re-run that reproduces the parameters already in force', async () => {
    const { repos: store, saved } = repos()
    const same = { logLoss: 0.3125, rmse: 0.0433 }
    const outcome = await createApplyOptimization({ repos: store })({
      result: trainingResult({ before: same, after: same }),
      confirm: true,
    })

    expect(outcome.applied).toBe(false)
    expect(outcome.check.logLossDelta).toBe(0)
    expect(saved).toHaveLength(0)
  })

  it('refuses an unconfirmed apply', async () => {
    const { repos: store } = repos()
    await expect(
      createApplyOptimization({ repos: store })({
        result: trainingResult(),
        confirm: false as unknown as true,
      }),
    ).rejects.toThrow(RangeError)
  })

  /** §7 rule 2 and §16: an accepted model never moves a due date. The repository slice the
   *  use case is given has no card access at all, which is what makes that structural. */
  it('touches no card when it applies', async () => {
    const { repos: store } = repos()
    expect(Object.keys(store)).toEqual(['reviewLogs', 'schedulerProfiles'])
  })

  it('clamps the trained parameters to the ranges of §3.3', async () => {
    const { repos: store, saved } = repos()
    const wild = DEFAULT_FSRS_W.map((_, index) => (index === 20 ? 99 : 1e9))
    await createApplyOptimization({ repos: store })({
      result: trainingResult({ w: wild, decay: 99 }),
      confirm: true,
    })
    // w20's range is [0.1, 0.8].
    expect(saved[0]?.w[20]).toBeLessThanOrEqual(0.8)
    expect(saved[0]?.decay).toBe(saved[0]?.w[20])
  })
})

describe('§16 — the status the settings screen shows', () => {
  it('reports the model, the history size and the offer', async () => {
    const cardId = '019a0000-0000-7000-8000-cccc00000002'
    const logs = Array.from({ length: 600 }, (_, index) =>
      reviewLogFixture({ cardId, rating: 3, review: new Date(NOW.getTime() - index * 1000) }),
    )
    const { repos: store } = repos({ logs })

    const status = await createOptimizerStatus({
      repos: store,
      clock: fakeClock(NOW.getTime()),
    })()

    expect(status.nReviews).toBe(600)
    expect(status.profile.trainedAt).toBeNull()
    // Never optimized, and past the 400-review floor.
    expect(status.offer).toEqual({ offered: true, reason: 'first', nextThresholdReviews: 512 })
  })

  /** §16 leaves the door open to a profile per domain once one has enough reviews of its
   *  own; the scope is a parameter everywhere rather than the global constant inlined. */
  it('answers for a named scope as well as the global one', async () => {
    const { repos: store } = repos()
    const status = await createOptimizerStatus({ repos: store })('domain:physiology')
    expect(status.profile.scope).toBe(GLOBAL_SCHEDULER_SCOPE)
    expect(status.nReviews).toBe(0)

    const prepared = await createPrepareOptimization({ repos: store })('domain:physiology')
    expect(prepared.scope).toBe('domain:physiology')
  })
})

describe('§15 — the composed Optimizer', () => {
  it('trains through the port and applies the verdict', async () => {
    const { repos: store, saved } = repos()
    const optimizer = createOptimizer({
      repos: store,
      clock: fakeClock(NOW.getTime()),
      trainer: { train: async () => trainingResult() },
    })

    const outcome = await optimizer.train({
      scope: GLOBAL_SCHEDULER_SCOPE,
      csv: `${OPTIMIZER_CSV_HEADER}\n`,
      nReviews: 5_000,
      profile: profileFixture(),
    })

    expect(outcome.applied).toBe(true)
    expect(saved).toHaveLength(1)
  })

  it('simulates without touching a repository', () => {
    const { repos: store } = repos()
    const optimizer = createOptimizer({
      repos: store,
      trainer: { train: async () => trainingResult() },
    })
    const result = optimizer.simulate({ learnSpan: 10, deckSize: 50 })
    expect(result.reviewCntPerDay).toHaveLength(10)
  })
})
