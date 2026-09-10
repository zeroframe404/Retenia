import type {
  ChunkRepository,
  Clock,
  GenerationRunRepository,
  JsonObject,
  KnowledgeItemRepository,
  Lesson,
  PathRepository,
} from '@retenia/core'
import type {
  GenerationEstimateDto,
  GenerationResultDto,
  GenerationRunDto,
  GenerationWarningDto,
  LessonRegenerateModeDto,
  LessonSummaryDto,
  PathDraftDto,
  PathDto,
  PathEditOpDto,
  PathStatsDto,
  PathVersionDto,
} from '@retenia/ipc-contract'
import {
  type ApplyEditOptions,
  applyEdit,
  type ExpansionRunHandle,
  freezePath,
  type GenerationConfigInput,
  type GenerationRunHandle,
  lessonCitationSchema,
  pathDraftSchema,
} from '@retenia/pathgen'
import {
  citedPageOf,
  perLessonUsdOf,
  toEditOp,
  toGenerationResultDto,
  toGenerationRunDto,
  toLessonSummaryDto,
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
    | 'findLesson'
    | 'findModule'
    | 'findSection'
    | 'listActivities'
  >
  readonly generationRuns: Pick<GenerationRunRepository, 'findById' | 'findLatestByPath'>
  readonly knowledgeItems: Pick<KnowledgeItemRepository, 'listByLesson'>
  /** For "Reportar error": a citation stores a display label, the reader route wants a page. */
  readonly chunks: Pick<ChunkRepository, 'findById'>
}

export interface PathgenFacadeDeps {
  readonly runs: GenerationRunHandle
  /** Stage 7's own run handle (sub-phase 8.3); a second `generation_runs` row per path. */
  readonly expansion: ExpansionRunHandle
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
  expand(input: {
    pathVersionId: string
    userWaiting?: boolean
    allowOverBudget?: boolean
  }): Promise<{ run: GenerationRunDto }>
  getLessons(input: { pathVersionId: string }): Promise<{ lessons: LessonSummaryDto[] }>
  regenerateLesson(input: {
    lessonId: string
    mode: LessonRegenerateModeDto
  }): Promise<{ run: GenerationRunDto; lesson: LessonSummaryDto | null }>
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

/**
 * The page "Reportar error" opens the source at.
 *
 * `lessons.citations[].locator` is what the parser called the position — `p. 8`, `12:30–13:45`,
 * a heading — so it renders but does not navigate. The chunk it names still carries the
 * structured locator, and `parseSourceLocator` is the same reader `buildLessonContext` used to
 * write the label in the first place. A source with no pages resolves to `null` and the link
 * opens it at its start, which beats not opening it at all.
 */
async function citedPage(deps: PathgenFacadeDeps, lesson: Lesson): Promise<number | null> {
  const citation = lessonCitationSchema.safeParse(lesson.citations[0])
  if (!citation.success) return null
  return citedPageOf(citation.data, await deps.repos.chunks.findById(citation.data.chunk_id))
}

/** One lesson plus the counts the panel shows, which are one query each. */
async function summarize(
  deps: PathgenFacadeDeps,
  lesson: Lesson,
  moduleTitle: string,
): Promise<LessonSummaryDto> {
  const [activities, items, page] = await Promise.all([
    deps.repos.paths.listActivities(lesson.id),
    deps.repos.knowledgeItems.listByLesson(lesson.id),
    citedPage(deps, lesson),
  ])
  return toLessonSummaryDto(lesson, moduleTitle, {
    activities: activities.length,
    flashcards: items.length,
    page,
  })
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

    /**
     * Stage 7 (`docs/spec/04-path-generation.md` §3 stage 7). Idempotent by construction: an
     * expansion already under way is continued rather than duplicated, and every lesson that
     * is already written is reused rather than paid for again.
     */
    expand: async ({ pathVersionId, userWaiting, allowOverBudget }) => {
      const result = await deps.expansion.expand(pathVersionId, {
        ...(userWaiting === undefined ? {} : { userWaiting }),
        ...(allowOverBudget === undefined ? {} : { allowOverBudget }),
      })
      const run = await deps.repos.generationRuns.findById(result.runId)
      if (run === undefined) throw new Error(`pathgen: run "${result.runId}" disappeared`)
      return { run: toGenerationRunDto(run) }
    },

    getLessons: async ({ pathVersionId }) => {
      const tree = await deps.repos.paths.loadTree(pathVersionId)
      if (tree === undefined) return { lessons: [] }
      const lessons: LessonSummaryDto[] = []
      for (const section of tree.sections) {
        for (const module of section.modules) {
          for (const lesson of module.lessons) {
            // The panel is about what stage 7 writes, and stage 7 writes core lessons only:
            // reinforcement and checkpoint nodes compose items that already exist (8.5).
            if (lesson.kind !== 'core') continue
            lessons.push(await summarize(deps, lesson, module.title))
          }
        }
      }
      return { lessons }
    },

    regenerateLesson: async ({ lessonId, mode }) => {
      const lesson = await deps.repos.paths.findLesson(lessonId)
      if (lesson === undefined) throw new Error(`pathgen: no lesson "${lessonId}"`)
      const module = await deps.repos.paths.findModule(lesson.moduleId)
      const section =
        module === undefined ? undefined : await deps.repos.paths.findSection(module.sectionId)
      if (section === undefined) throw new Error(`pathgen: lesson "${lessonId}" has no version`)

      // The user pressed a button and is watching: this one is never batched (§3 stage 7's
      // `userWaiting` is "the one input that overrides everything else").
      const result = await deps.expansion.expand(section.pathVersionId, {
        userWaiting: true,
        onlyLessonIds: [lesson.specId],
        ...(mode === 'regenerate' ? { regenerate: true } : { moreExamples: true }),
      })
      const run = await deps.repos.generationRuns.findById(result.runId)
      if (run === undefined) throw new Error(`pathgen: run "${result.runId}" disappeared`)
      const updated = await deps.repos.paths.findLesson(lessonId)
      return {
        run: toGenerationRunDto(run),
        lesson: updated === undefined ? null : await summarize(deps, updated, module?.title ?? ''),
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
