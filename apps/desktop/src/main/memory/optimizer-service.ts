import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  ApplyOptimization,
  JobRepository,
  OptimizationOutcome,
  OptimizerStatus,
  OptimizerStatusQuery,
  OptimizerTrainingResult,
  PrepareOptimization,
  UnitOfWork,
} from '@retenia/core'
import {
  createApplyOptimization,
  createOptimizerStatus,
  createPrepareOptimization,
  GLOBAL_SCHEDULER_SCOPE,
} from '@retenia/core'
import type { FsrsOptimizeResult } from '../../jobs/fsrs-optimize'
import { log } from '../logging/log'
import { getWorkRoot } from '../paths'

/**
 * Running an optimization end to end (`docs/spec/02-memory-system.md` §6, §16).
 *
 * Three processes are involved and the split matters:
 *
 * 1. **main** reads the review history and writes it as an `fsrs-optimizer` CSV — a path,
 *    not a payload: a large collection's history is megabytes, and `jobs.payload` is a
 *    persisted JSON column re-read on every retry.
 * 2. **the worker** trains, and measures the current and the trained parameters on the same
 *    converted item set. It decides nothing, because it cannot write to SQLite.
 * 3. **main** applies §16's health check and, only if the model improved, stores it.
 *
 * No card is touched at any point. §7 rule 2 and §16 both say the new parameters apply from
 * each card's next review.
 */

const CSV_DIR = 'fsrs'
const JOB_KIND = 'fsrsOptimize'

/** A staged CSV older than this is from a run that never finished — a crash, or a quit
 *  mid-training — and is swept at startup. */
const STALE_CSV_MS = 24 * 60 * 60 * 1000

export interface OptimizerServiceOptions {
  repos: UnitOfWork
  /** The device's zone, for bucketing reviews into study days. */
  timeZone: string
}

export interface OptimizerService {
  status: OptimizerStatusQuery
  /** Stage the history and queue the training. Returns the job id to follow. */
  start(scope?: string): Promise<{ jobId: string; nReviews: number }>
  /** Apply what a finished job produced, if the health check accepts it. */
  apply(jobId: string, scope?: string): Promise<OptimizationOutcome>
  /** Remove a finished run's staged CSV. */
  cleanup(jobId: string): Promise<void>
  /** Drop CSVs left behind by a run that never reached a terminal state. */
  sweep(): Promise<number>
}

function csvPath(jobId: string): string {
  return join(getWorkRoot(), CSV_DIR, `${jobId}.csv`)
}

/** The job's JSON result, widened back to the port's type. They are the same shape; the
 *  job spells it with mutable arrays because `jobs.result` is a JSON column. */
function toTrainingResult(result: FsrsOptimizeResult): OptimizerTrainingResult {
  return {
    w: result.w,
    decay: result.decay,
    before: result.before,
    after: result.after,
    nReviews: result.nReviews,
    nItems: result.nItems,
  }
}

export function createOptimizerService(options: OptimizerServiceOptions): OptimizerService {
  const { repos, timeZone } = options
  const prepare: PrepareOptimization = createPrepareOptimization({ repos })
  const applyOptimization: ApplyOptimization = createApplyOptimization({ repos })
  const status: OptimizerStatusQuery = createOptimizerStatus({ repos })
  const jobs: JobRepository = repos.jobs

  const cleanup = async (jobId: string): Promise<void> => {
    await rm(csvPath(jobId), { force: true })
  }

  return {
    status,

    start: async (scope = GLOBAL_SCHEDULER_SCOPE) => {
      const { csv, nReviews, profile } = await prepare(scope)
      if (nReviews === 0) {
        throw new Error('There is no review history to optimize yet')
      }
      const dayStartHour = await repos.settings.get('review.dayStartHour')

      // The row is created first, so the CSV can be named after the job it belongs to and
      // the sweep can tell a live staging file from an abandoned one.
      const job = await jobs.enqueue(
        JOB_KIND,
        {
          path: '',
          currentW: [...profile.w],
          nextDayStartsAt: dayStartHour,
          timeZone,
          enableShortTerm: profile.enableShortTerm,
          numRelearningSteps: profile.relearningSteps.length,
        },
        { subjectId: profile.id },
      )
      const path = csvPath(job.id)
      await mkdir(join(getWorkRoot(), CSV_DIR), { recursive: true })
      await writeFile(path, csv, 'utf8')
      await jobs.update(job.id, { payload: { ...job.payload, path } })
      log.info(`[optimizer] queued ${job.id} over ${nReviews} reviews`)
      return { jobId: job.id, nReviews }
    },

    apply: async (jobId, scope = GLOBAL_SCHEDULER_SCOPE) => {
      const job = await jobs.findById(jobId)
      if (job === undefined) throw new Error(`No optimization job ${jobId}`)
      if (job.kind !== JOB_KIND) throw new Error(`Job ${jobId} is not an optimization`)
      if (job.status !== 'succeeded' || job.result === null) {
        throw new Error(`Optimization ${jobId} has not finished (${job.status})`)
      }
      const outcome = await applyOptimization({
        scope,
        result: toTrainingResult(job.result as unknown as FsrsOptimizeResult),
        confirm: true,
      })
      await cleanup(jobId)
      log.info(
        `[optimizer] ${jobId} ${outcome.applied ? 'applied' : 'rejected'}: ` +
          `log loss ${outcome.before.logLoss.toFixed(4)} → ${outcome.after.logLoss.toFixed(4)}`,
      )
      return outcome
    },

    cleanup,

    sweep: async () => {
      const directory = join(getWorkRoot(), CSV_DIR)
      let names: string[]
      try {
        names = await readdir(directory)
      } catch {
        // Nothing has ever been staged.
        return 0
      }
      const cutoff = Date.now() - STALE_CSV_MS
      let removed = 0
      for (const name of names) {
        if (!name.endsWith('.csv')) continue
        const jobId = name.slice(0, -4)
        const job = await jobs.findById(jobId)
        const finished = job === undefined || job.status !== 'queued'
        if (!finished) continue
        const staleEnough = job === undefined || job.createdAt.getTime() < cutoff
        if (!staleEnough) continue
        await rm(join(directory, name), { force: true })
        removed += 1
      }
      return removed
    },
  }
}

export type { OptimizerStatus }
