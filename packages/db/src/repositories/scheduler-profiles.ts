import type {
  NewEntity,
  SchedulerProfile,
  SchedulerProfileRepository,
  TrainedParameters,
} from '@retenia/core'
import { DEFAULT_FSRS_W, DEFAULT_LEARNING_STEPS, DEFAULT_RELEARNING_STEPS } from '@retenia/core'
import { eq } from 'drizzle-orm'
import { schedulerProfiles } from '../schema'
import { type BaseRepository, createBaseRepository, type Row, type TableCodec } from './base'
import type { RepositoryContext } from './context'
import {
  defined,
  fromBool,
  fromDateOrNull,
  toBool,
  toDate,
  toDateOrNull,
  toNumber,
  toNumberOrNull,
  toText,
} from './mapping'

/**
 * `scheduler_profiles` (docs/spec/02-memory-system.md §6, §14): the FSRS parameters in
 * force, one live row per scope.
 *
 * Read once at startup and after every accepted optimization — never per card. The
 * partial unique index `scheduler_profiles_scope_live` is what makes `scope` a natural key
 * among live rows, so `ensure` can upsert against it.
 */

type NewSchedulerProfile = NewEntity<SchedulerProfile>
type SchedulerProfileColumns = Partial<NewSchedulerProfile> & { version?: number }

const codec: TableCodec<SchedulerProfile, NewSchedulerProfile, SchedulerProfileColumns> = {
  table: schedulerProfiles,
  name: 'scheduler_profiles',
  toEntity: (row: Row): SchedulerProfile => ({
    id: toText(row.id),
    scope: toText(row.scope),
    algorithm: toText(row.algorithm),
    w: row.w as number[],
    decay: toNumberOrNull(row.decay),
    learningSteps: row.learningSteps as string[],
    relearningSteps: row.relearningSteps as string[],
    enableFuzz: toBool(row.enableFuzz),
    enableShortTerm: toBool(row.enableShortTerm),
    maximumInterval: toNumber(row.maximumInterval),
    dayStartHour: toNumber(row.dayStartHour),
    trainedAt: toDateOrNull(row.trainedAt),
    nReviews: toNumberOrNull(row.nReviews),
    logLoss: toNumberOrNull(row.logLoss),
    rmse: toNumberOrNull(row.rmse),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: toDateOrNull(row.deletedAt),
    deviceId: toText(row.deviceId),
    version: toNumber(row.version),
  }),
  toInsert: (input) =>
    defined({
      scope: input.scope,
      algorithm: input.algorithm,
      w: input.w,
      decay: input.decay ?? null,
      learningSteps: input.learningSteps,
      relearningSteps: input.relearningSteps,
      enableFuzz: fromBool(input.enableFuzz),
      enableShortTerm: fromBool(input.enableShortTerm),
      maximumInterval: input.maximumInterval,
      dayStartHour: input.dayStartHour,
      trainedAt: fromDateOrNull(input.trainedAt),
      nReviews: input.nReviews ?? null,
      logLoss: input.logLoss ?? null,
      rmse: input.rmse ?? null,
    }),
  toUpdate: (patch) =>
    defined({
      scope: patch.scope,
      algorithm: patch.algorithm,
      w: patch.w,
      decay: patch.decay,
      learningSteps: patch.learningSteps,
      relearningSteps: patch.relearningSteps,
      enableFuzz: patch.enableFuzz === undefined ? undefined : fromBool(patch.enableFuzz),
      enableShortTerm:
        patch.enableShortTerm === undefined ? undefined : fromBool(patch.enableShortTerm),
      maximumInterval: patch.maximumInterval,
      dayStartHour: patch.dayStartHour,
      trainedAt: patch.trainedAt === undefined ? undefined : fromDateOrNull(patch.trainedAt),
      nReviews: patch.nReviews,
      logLoss: patch.logLoss,
      rmse: patch.rmse,
    }),
}

export function createSchedulerProfileRepository(
  ctx: RepositoryContext,
): SchedulerProfileRepository {
  const base: BaseRepository<SchedulerProfile, NewSchedulerProfile, SchedulerProfileColumns> =
    createBaseRepository(ctx, codec)

  const findByScope = async (scope: string): Promise<SchedulerProfile | undefined> => {
    const [row] = await base.findWhere(eq(schedulerProfiles.scope, scope), { limit: 1 })
    return row
  }

  /**
   * The row for `scope`, created from the published FSRS-6 defaults when it is missing.
   *
   * A lazy upsert rather than a seed migration, because the defaults are
   * `DEFAULT_FSRS_W` in `@retenia/core` and a migration copying those 21 numbers into
   * SQLite would be a second source of truth that goes stale the day `ts-fsrs` ships new
   * ones.
   */
  const ensure = async (scope: string): Promise<SchedulerProfile> => {
    const existing = await findByScope(scope)
    if (existing !== undefined) return existing
    return base.create({
      scope,
      algorithm: 'fsrs6',
      w: [...DEFAULT_FSRS_W],
      decay: DEFAULT_FSRS_W[20] as number,
      learningSteps: [...DEFAULT_LEARNING_STEPS],
      relearningSteps: [...DEFAULT_RELEARNING_STEPS],
      enableFuzz: true,
      enableShortTerm: true,
      maximumInterval: 36_500,
      dayStartHour: 4,
      trainedAt: null,
      nReviews: null,
      logLoss: null,
      rmse: null,
    })
  }

  return {
    findById: base.findById,
    findMany: base.findMany,
    list: base.list,
    count: base.count,
    create: base.create,
    update: base.update,
    save: base.save,
    softDelete: base.softDelete,
    restore: base.restore,

    findByScope,
    ensure,

    /**
     * Write an accepted optimization's parameters.
     *
     * Parameters only: no card is read or written here. §16's "never reschedule en masse
     * except by explicit action" and §7 rule 2 both mean the new `w` takes effect at each
     * card's next review, with S, D and every due date untouched.
     */
    saveTrained: async (scope: string, trained: TrainedParameters) => {
      const profile = await ensure(scope)
      return base.update(profile.id, {
        w: [...trained.w],
        decay: trained.decay,
        trainedAt: trained.trainedAt,
        nReviews: trained.nReviews,
        logLoss: trained.logLoss,
        rmse: trained.rmse,
      })
    },
  }
}
