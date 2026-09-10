import type { Clock, GenerationRunRepository, JsonObject, PathRepository } from '@retenia/core'
import type {
  GenerationEstimateDto,
  GenerationResultDto,
  GenerationRunDto,
  GenerationWarningDto,
  PathDraftDto,
  PathDto,
  PathEditOpDto,
  PathStatsDto,
  PathVersionDto,
} from '@retenia/ipc-contract'
import {
  type ApplyEditOptions,
  applyEdit,
  freezePath,
  type GenerationConfigInput,
  type GenerationRunHandle,
  pathDraftSchema,
} from '@retenia/pathgen'
import {
  perLessonUsdOf,
  toEditOp,
  toGenerationResultDto,
  toGenerationRunDto,
  toPathDto,
  toPathVersionDto,
} from './dto'

/**
 * What the `pathgen.*` IPC handlers call. A thin seam over `createGenerationRun`'s handle plus
 * the repositories `editDraft`/`freeze`/`getRun`/`getVersion` read directly — the same shape
 * `JobsFacade` gives `jobs.*` — so `handlers.ts` stays a list of one-liners and this can be
 * faked in its own tests.
 */

export interface PathgenFacadeRepos {
  readonly paths: Pick<
    PathRepository,
    | 'findVersion'
    | 'findById'
    | 'update'
    | 'updateVersion'
    | 'createSection'
    | 'createModule'
    | 'createLesson'
    | 'freezeVersion'
    | 'setActiveVersion'
    | 'loadTree'
  >
  readonly generationRuns: Pick<GenerationRunRepository, 'findById' | 'findLatestByPath'>
}

export interface PathgenFacadeDeps {
  readonly runs: GenerationRunHandle
  readonly repos: PathgenFacadeRepos
  readonly clock: Clock
  /** The wizard's live pre-flight estimate — a separate function from `runs` because it must
   *  never create a `paths`/`generation_runs` row (`docs/spec/04-path-generation.md` §13 step
   *  1). Bound to its dependencies in `bootstrap.ts`. */
  quote(
    input: GenerationConfigInput,
  ): Promise<{ estimate: GenerationEstimateDto; warnings: GenerationWarningDto[] }>
}

export interface PathgenFacade {
  quote(input: {
    config: GenerationConfigInput
  }): Promise<{ estimate: GenerationEstimateDto; warnings: GenerationWarningDto[] }>
  start(input: {
    config: GenerationConfigInput
    pathId?: string
    userWaiting?: boolean
    allowOverBudget?: boolean
  }): Promise<GenerationResultDto>
  resume(input: { runId: string; allowOverBudget?: boolean }): Promise<GenerationResultDto>
  cancel(input: { runId: string }): Promise<{ run: GenerationRunDto | null }>
  getRun(input: { runId: string }): Promise<{ run: GenerationRunDto | null }>
  getVersion(input: {
    pathVersionId: string
  }): Promise<{ path: PathDto; version: PathVersionDto; draft: PathDraftDto }>
  editDraft(input: { pathVersionId: string; op: PathEditOpDto }): Promise<{
    draft: PathDraftDto
    warnings: GenerationWarningDto[]
    breaksPrerequisite: boolean
    projectedCostDeltaUsd?: number
  }>
  freeze(input: {
    pathVersionId: string
  }): Promise<{ path: PathDto; version: PathVersionDto; stats: PathStatsDto }>
}

async function loadVersion(repos: PathgenFacadeRepos, pathVersionId: string) {
  const version = await repos.paths.findVersion(pathVersionId)
  if (version === undefined) {
    throw new Error(`pathgen: no path version "${pathVersionId}"`)
  }
  const path = await repos.paths.findById(version.pathId)
  if (path === undefined) {
    throw new Error(`pathgen: no path "${version.pathId}"`)
  }
  return { path, version, draft: pathDraftSchema.parse(version.spec) }
}

export function createPathgenFacade(deps: PathgenFacadeDeps): PathgenFacade {
  return {
    quote: ({ config }) => deps.quote(config),

    start: async ({ config, pathId, userWaiting, allowOverBudget }) => {
      const result = await deps.runs.start(config, {
        ...(pathId === undefined ? {} : { pathId }),
        ...(userWaiting === undefined ? {} : { userWaiting }),
        ...(allowOverBudget === undefined ? {} : { allowOverBudget }),
      })
      return toGenerationResultDto(result)
    },

    resume: async ({ runId, allowOverBudget }) => {
      const result = await deps.runs.resume(
        runId,
        allowOverBudget === undefined ? {} : { allowOverBudget },
      )
      return toGenerationResultDto(result)
    },

    cancel: async ({ runId }) => {
      const run = await deps.runs.cancel(runId)
      return { run: run === undefined ? null : toGenerationRunDto(run) }
    },

    getRun: async ({ runId }) => {
      const run = await deps.repos.generationRuns.findById(runId)
      return { run: run === undefined ? null : toGenerationRunDto(run) }
    },

    getVersion: async ({ pathVersionId }) => {
      const { path, version, draft } = await loadVersion(deps.repos, pathVersionId)
      return { path: toPathDto(path), version: toPathVersionDto(version), draft }
    },

    editDraft: async ({ pathVersionId, op }) => {
      const { version, draft } = await loadVersion(deps.repos, pathVersionId)
      if (version.frozenAt !== null) {
        throw new Error(`pathgen: path version "${pathVersionId}" is frozen`)
      }
      const editOp = toEditOp(op)
      const options: ApplyEditOptions =
        editOp.kind === 'deepenLesson'
          ? {
              perLessonUsd: perLessonUsdOf(
                await deps.repos.generationRuns.findLatestByPath(version.pathId),
              ),
            }
          : {}
      const result = applyEdit(draft, editOp, options)
      await deps.repos.paths.updateVersion(pathVersionId, {
        spec: result.draft as unknown as JsonObject,
      })
      return {
        draft: result.draft,
        warnings: [...result.warnings],
        breaksPrerequisite: result.breaksPrerequisite,
        ...(result.projectedCostDeltaUsd === undefined
          ? {}
          : { projectedCostDeltaUsd: result.projectedCostDeltaUsd }),
      }
    },

    freeze: async ({ pathVersionId }) => {
      const { draft } = await loadVersion(deps.repos, pathVersionId)
      const result = await freezePath({ repos: deps.repos, clock: deps.clock }, { pathVersionId })
      return {
        path: toPathDto(result.path),
        version: toPathVersionDto(result.version),
        stats: draft.stats,
      }
    },
  }
}
