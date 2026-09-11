import type { Chunk, GenerationRun, LearningPath, Lesson, PathVersion } from '@retenia/core'
import { parseSourceLocator } from '@retenia/core'
import {
  type GenerationResultDto,
  type GenerationRunDto,
  type GenerationStageDto,
  generationEstimateDtoSchema,
  generationWarningDtoSchema,
  type LessonQaSummaryDto,
  type LessonSummaryDto,
  type PathDto,
  type PathEditOpDto,
  type PathVersionDto,
  type QaFindingDto,
  type QaReportLessonDto,
} from '@retenia/ipc-contract'
import {
  GENERATION_STAGES,
  type GenerationResult,
  type LessonCitation,
  type LessonQa,
  lessonCitationSchema,
  lessonExpansionSchema,
  type PathEditOp,
  pathDraftSchema,
  readLessonQa,
  summarizeQa,
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
  if (!estimate.success) return 0

  // What one more lesson actually costs, now that the quote covers stage 7: writing it, its
  // exercises and its cards. Before sub-phase 8.3 the quote stopped at P2, so the per-module
  // synthesis cost was the only proxy available — an estimate stored back then still parses
  // (the stage-7 fields default to zero) and still falls back to it.
  const { p3Lessons, p4Activities, p5Flashcards, p6Faithfulness, p7Judge, p8Edit, qaRegenerate } =
    estimate.data
  if (p3Lessons.calls > 0) {
    // Stage 8's rows too (sub-phase 8.4): a deeper lesson is also a lesson to verify, judge
    // and, a third of the time, edit.
    return (
      (p3Lessons.usd +
        p4Activities.usd +
        p5Flashcards.usd +
        p6Faithfulness.usd +
        p7Judge.usd +
        p8Edit.usd +
        qaRegenerate.usd) /
      p3Lessons.calls
    )
  }
  const { p2Modules } = estimate.data
  return p2Modules.calls === 0 ? 0 : p2Modules.usd / p2Modules.calls
}

/** `lessons.qa` as the badge sees it, or `null` for a lesson the gates have not reached. */
export function toLessonQaSummaryDto(qa: LessonQa | null): LessonQaSummaryDto | null {
  if (qa === null) return null
  const summary = summarizeQa(qa)
  return {
    faithfulness: summary.faithfulness,
    pedagogyScore: summary.pedagogyScore,
    coverageOk: summary.coverageOk,
    verdict: summary.verdict,
    reviewed: summary.reviewed,
    sourcesCount: summary.sourcesCount,
    findings: summary.findings,
  }
}

/** A citation of the report, with the page the caller resolved for it. */
export interface ResolvedCitationDto {
  readonly id: string
  readonly sourceId: string
  readonly locator: string
  readonly page: number | null
  readonly blockIds: string[]
}

/** `lessons.citations`, parsed, keyed by cite id — what a finding's `citation_ids` name. */
export function citationsOf(lesson: Lesson): Map<string, LessonCitation> {
  const out = new Map<string, LessonCitation>()
  for (const raw of lesson.citations) {
    const parsed = lessonCitationSchema.safeParse(raw)
    if (parsed.success) out.set(parsed.data.id, parsed.data)
  }
  return out
}

/**
 * One lesson of the QA report (sub-phase 8.4). `resolve` turns a cite id into what the
 * reader route can open, or `undefined` for an id the lesson no longer stores — a finding
 * about a stripped citation still names the id it stripped.
 */
export function toQaReportLessonDto(
  lesson: Lesson,
  moduleTitle: string,
  resolve: (citationId: string) => ResolvedCitationDto | undefined,
): QaReportLessonDto {
  const qa = readLessonQa(lesson.qa)
  const findings: QaFindingDto[] =
    qa === null
      ? []
      : qa.findings.map((finding) => ({
          gate: finding.gate,
          kind: finding.kind,
          blockIndex: finding.block_index,
          sentence: finding.sentence,
          detail: finding.detail,
          citations: finding.citation_ids.flatMap((id) => {
            const citation = resolve(id)
            return citation === undefined ? [] : [citation]
          }),
        }))
  return {
    lessonId: lesson.id,
    specId: lesson.specId,
    moduleTitle,
    title: lesson.title,
    status: lesson.status,
    qa: toLessonQaSummaryDto(qa),
    gates: qa === null ? [] : qa.gates.map((gate) => ({ gate: gate.gate, outcome: gate.outcome })),
    findings,
    warnings: qa === null ? [] : toWarningsDto(qa.warnings),
  }
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

/**
 * One lesson as the expansion panel shows it (sub-phase 8.3).
 *
 * Everything here is already on the row or one count away from it, and none of it is the
 * theory: the panel renders a chip, two counts and three buttons, and shipping tens of
 * kilobytes of Markdown per lesson across the boundary for that would be a list nobody could
 * scroll. `firstCitation` is what "Reportar error" opens.
 */
/**
 * The page `firstCitation` may carry, given the chunk the citation names.
 *
 * Two things have to hold and neither is guaranteed by a type. The chunk must be the one the
 * citation claims — `lessonCitationSchema` types `source_id` and `chunk_id` as bare strings,
 * so only `resolveCitations` writing both from one fragment keeps them in step. And the page
 * must be a positive integer: `parseSourceLocator` is deliberately permissive, because the
 * `locator` column is written by ingestion parsers and later by importers of other apps'
 * data, so it can hand back 0, a negative or a fraction. The DTO is `z.int().positive()` and
 * `registerHandlers` validates the whole answer, so one 0-based page anywhere in a path would
 * fail `pathgen.getLessons` for every lesson in it. Both failures degrade to `null`, which the
 * contract already means "open the source at its start".
 */
export function citedPageOf(
  citation: { readonly source_id: string; readonly chunk_id: string },
  chunk: (Pick<Chunk, 'locator' | 'unitId'> & { readonly sourceId: string }) | undefined,
): number | null {
  if (chunk === undefined || chunk.sourceId !== citation.source_id) return null
  const { page } = parseSourceLocator(chunk)
  return page !== null && Number.isInteger(page) && page > 0 ? page : null
}

export function toLessonSummaryDto(
  lesson: Lesson,
  moduleTitle: string,
  counts: {
    readonly activities: number
    readonly flashcards: number
    /** Resolved from the cited chunk by the caller — `lessons.citations` stores a label. */
    readonly page?: number | null
  },
): LessonSummaryDto {
  const expansion = lessonExpansionSchema.safeParse(lesson.expansion)
  const citation = lessonCitationSchema.safeParse(lesson.citations[0])
  return {
    id: lesson.id,
    specId: lesson.specId,
    moduleTitle,
    title: lesson.title,
    status: lesson.status,
    activities: counts.activities,
    flashcards: counts.flashcards,
    unmet: expansion.success ? (expansion.data.p4?.unmet ?? []) : [],
    warnings: expansion.success ? toWarningsDto(expansion.data.warnings) : [],
    firstCitation: citation.success
      ? {
          sourceId: citation.data.source_id,
          locator: citation.data.locator,
          page: counts.page ?? null,
          blockIds: [...citation.data.block_ids],
        }
      : null,
    qa: toLessonQaSummaryDto(readLessonQa(lesson.qa)),
  }
}
