import type { GenerationRun, LearningPath, PathVersion } from '@retenia/core'
import {
  type GenerationResultDto,
  type GenerationRunDto,
  type GenerationStageDto,
  generationEstimateDtoSchema,
  generationWarningDtoSchema,
  type PathDto,
  type PathEditOpDto,
  type PathVersionDto,
} from '@retenia/ipc-contract'
import {
  GENERATION_STAGES,
  type GenerationResult,
  type PathEditOp,
  pathDraftSchema,
} from '@retenia/pathgen'

/** Domain → wire conversions for every `pathgen.*` channel — kept beside the facade, the same
 *  place `apps/desktop/src/main/ipc/handlers.ts` keeps every other domain's `toXDto`. */

const STAGE_SET = new Set<string>(GENERATION_STAGES)

function toStage(value: unknown): GenerationStageDto {
  return typeof value === 'string' && STAGE_SET.has(value)
    ? (value as GenerationStageDto)
    : 'reading_sources'
}

function toProgress(run: GenerationRun): GenerationRunDto['progress'] {
  const raw = run.progress as { stage?: unknown; done?: unknown; total?: unknown } | null
  return {
    stage: toStage(raw?.stage),
    done: typeof raw?.done === 'number' ? raw.done : 0,
    total: typeof raw?.total === 'number' ? raw.total : 0,
  }
}

function toWarningsDto(warnings: readonly unknown[]): GenerationRunDto['warnings'] {
  const out: GenerationRunDto['warnings'] = []
  for (const entry of warnings) {
    const parsed = generationWarningDtoSchema.safeParse(entry)
    if (parsed.success) out.push(parsed.data)
  }
  return out
}

export function toGenerationRunDto(run: GenerationRun): GenerationRunDto {
  const estimate = generationEstimateDtoSchema.safeParse(run.estimate)
  return {
    id: run.id,
    pathId: run.pathId,
    pathVersionId: run.pathVersionId,
    status: run.status,
    progress: toProgress(run),
    estimate: estimate.success ? estimate.data : null,
    costUsd: run.costUsd,
    warnings: toWarningsDto(run.warnings),
    error: run.error,
  }
}

export function toGenerationResultDto(result: GenerationResult): GenerationResultDto {
  return {
    runId: result.runId,
    pathId: result.pathId,
    pathVersionId: result.pathVersionId,
    status: result.status,
    warnings: toWarningsDto(result.warnings),
    draft: result.draft,
    error: result.error,
  }
}

export function toPathDto(path: LearningPath): PathDto {
  return {
    id: path.id,
    title: path.title,
    language: path.language,
    level: path.level,
    goal: path.goal,
    targetDate: path.targetDate,
    status: path.status,
    activeVersion: path.activeVersion,
  }
}

export function toPathVersionDto(version: PathVersion): PathVersionDto {
  return {
    id: version.id,
    pathId: version.pathId,
    number: version.number,
    frozenAt: version.frozenAt === null ? null : version.frozenAt.toISOString(),
  }
}

/** The per-lesson expansion rate a run's own quote priced — what `deepenLesson`'s cost
 *  projection multiplies by. `0` when no run's estimate is on record for the path yet. */
export function perLessonUsdOf(run: GenerationRun | undefined): number {
  if (run === undefined) return 0
  const estimate = generationEstimateDtoSchema.safeParse(run.estimate)
  if (!estimate.success || estimate.data.p2Modules.calls === 0) return 0
  return estimate.data.p2Modules.usd / estimate.data.p2Modules.calls
}

/** `PathEditOpDto` → `PathEditOp`: the wire shape is looser (a `replace` draft is validated
 *  only structurally), so `replace` is re-validated with pathgen's own `pathDraftSchema` —
 *  the same guard every generated draft already goes through — before it can ever become the
 *  new `path_versions.spec`. */
export function toEditOp(dto: PathEditOpDto): PathEditOp {
  switch (dto.kind) {
    case 'rename':
      return { kind: 'rename', nodeId: dto.nodeId, title: dto.title }
    case 'reorder':
      return { kind: 'reorder', nodeId: dto.nodeId, toIndex: dto.toIndex }
    case 'exclude':
      return { kind: 'exclude', nodeId: dto.nodeId }
    case 'markKnown':
      return { kind: 'markKnown', nodeId: dto.nodeId }
    case 'unmarkKnown':
      return { kind: 'unmarkKnown', nodeId: dto.nodeId }
    case 'mergeLessons': {
      const [first, second, ...rest] = dto.lessonIds
      if (first === undefined || second === undefined) {
        throw new Error('pathgen.editDraft: mergeLessons needs at least two lesson ids')
      }
      return { kind: 'mergeLessons', lessonIds: [first, second, ...rest] }
    }
    case 'splitLesson':
      return { kind: 'splitLesson', lessonId: dto.lessonId, parts: dto.parts }
    case 'deepenLesson':
      return { kind: 'deepenLesson', lessonId: dto.lessonId, parts: dto.parts }
    case 'setPrimarySource':
      return { kind: 'setPrimarySource', sourceId: dto.sourceId }
    case 'replace':
      return { kind: 'replace', draft: pathDraftSchema.parse(dto.draft) }
  }
}
