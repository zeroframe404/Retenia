import type { Lesson, PathRepository, PathVersion, Remediation } from '@retenia/core'
import type {
  AffectedLessonsDto,
  RemediationDecisionDto,
  RemediationDto,
  VersionDiffDto,
} from '@retenia/ipc-contract'
import {
  type AffectedResult,
  knowledgeGraphDocumentSchema,
  type RemediationDecision,
  readBoost,
  type VersionDiff,
} from '@retenia/pathgen'

/**
 * The remediation log, the version diff and the affected-lessons report as the renderer reads
 * them (sub-phase 8.6). Everything crossing the bridge is bounded here to what the contract
 * allows, so a long concept name or an unusually large diff truncates instead of failing the
 * whole call.
 */

const MAX_TEXT = 1_000
const MAX_NAME = 500
const MAX_CONCEPTS = 64
const MAX_LESSONS = 2_000

const clip = (text: string, max: number): string => (text.length <= max ? text : text.slice(0, max))

const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const unitOrNull = (value: unknown): number | null => {
  const n = numberOrNull(value)
  return n === null ? null : Math.min(1, Math.max(0, n))
}

const countOrNull = (value: unknown): number | null => {
  const n = numberOrNull(value)
  return n === null ? null : Math.max(0, Math.round(n))
}

/** Concept id → canonical name, from any number of `path_versions.knowledge_graph` values. */
export function conceptNamesOf(...graphs: readonly unknown[]): Map<string, string> {
  const names = new Map<string, string>()
  for (const graph of graphs) {
    const parsed = knowledgeGraphDocumentSchema.safeParse(graph)
    if (!parsed.success) continue
    for (const node of parsed.data.nodes) {
      if (!names.has(node.concept_id)) names.set(node.concept_id, node.canonical)
    }
  }
  return names
}

export interface RemediationDtoContext {
  readonly lesson: Lesson | null
  readonly anchorSpecId: string | null
  readonly conceptName: string
}

export function toRemediationDto(row: Remediation, context: RemediationDtoContext): RemediationDto {
  const boost = readBoost(row.boost)
  const position = context.lesson?.remediation?.position
  const evidence = row.evidence
  const revisit = evidence.revisit_lesson_id
  return {
    id: row.id,
    pathVersionId: row.pathVersionId,
    moduleId: row.moduleId,
    conceptId: clip(row.conceptId, 128),
    conceptName: clip(context.conceptName, MAX_NAME),
    misconceptionId: row.misconceptionId === null ? null : clip(row.misconceptionId, 64),
    trigger: row.trigger,
    status: row.status,
    refusal: row.refusal,
    lessonId: row.lessonId,
    specId: row.specId,
    anchorLessonId: row.anchorLessonId,
    anchorSpecId: context.anchorSpecId,
    position: position === 'before' || position === 'after' ? position : null,
    title: context.lesson === null ? null : clip(context.lesson.title, MAX_TEXT),
    lessonStatus: context.lesson?.status ?? null,
    estimatedMinutes:
      context.lesson?.estimatedMinutes === null || context.lesson?.estimatedMinutes === undefined
        ? null
        : Math.min(60, Math.max(0, Math.round(context.lesson.estimatedMinutes))),
    reasons: {
      accuracy: unitOrNull(evidence.accuracy),
      lapses: countOrNull(evidence.lapses),
      meanR: unitOrNull(evidence.mean_r),
      failures: countOrNull(evidence.failures),
      context:
        evidence.context === 'diagnostic' || evidence.context === 'exam' ? evidence.context : null,
    },
    revisitLessonId: row.refusal === 'revisit_core' && typeof revisit === 'string' ? revisit : null,
    boostedCards: Math.max(0, boost.cardIds.length - boost.cleared.length),
    boostExpiresAt: boost.expiresAt,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt === null ? null : row.resolvedAt.toISOString(),
  }
}

export type RemediationDtoBuilder = (
  row: Remediation,
  lesson?: Lesson | null,
) => Promise<RemediationDto>

/** Reads what a row does not carry — its lesson, its anchor's id, its concept's name. */
export function createRemediationDtoBuilder(
  paths: Pick<PathRepository, 'findVersion' | 'findLesson'>,
): RemediationDtoBuilder {
  return async (row, lesson) => {
    const [version, own, anchor] = await Promise.all([
      paths.findVersion(row.pathVersionId),
      lesson !== undefined || row.lessonId === null
        ? Promise.resolve(lesson ?? null)
        : paths.findLesson(row.lessonId).then((found) => found ?? null),
      row.anchorLessonId === null
        ? Promise.resolve(undefined)
        : paths.findLesson(row.anchorLessonId),
    ])
    return toRemediationDto(row, {
      lesson: own,
      anchorSpecId: anchor?.specId ?? null,
      conceptName: conceptNameIn(version, row.conceptId),
    })
  }
}

function conceptNameIn(version: PathVersion | undefined, conceptId: string): string {
  return conceptNamesOf(version?.knowledgeGraph).get(conceptId) ?? conceptId
}

export async function toRemediationDecisionDto(
  decision: RemediationDecision | undefined,
  build: RemediationDtoBuilder,
): Promise<RemediationDecisionDto> {
  if (decision === undefined || decision.kind === 'ignored') {
    return { kind: 'ignored', refusal: null, remediation: null }
  }
  if (decision.kind === 'refused') {
    return {
      kind: 'refused',
      refusal: decision.refusal,
      remediation: decision.remediation === null ? null : await build(decision.remediation),
    }
  }
  if (decision.kind === 'failed') {
    return { kind: 'failed', refusal: null, remediation: await build(decision.remediation) }
  }
  return {
    kind: 'inserted',
    refusal: null,
    remediation: await build(decision.remediation, decision.lesson),
  }
}

export function toVersionDiffDto(
  diff: VersionDiff,
  names: ReadonlyMap<string, string>,
): VersionDiffDto {
  const lessons = diff.lessons.slice(0, MAX_LESSONS).map((entry) => ({
    change: entry.change,
    specId: entry.spec_id,
    title: entry.title === null ? null : clip(entry.title, MAX_TEXT),
    previousSpecId: entry.previous_spec_id,
    previousTitle: entry.previous_title === null ? null : clip(entry.previous_title, MAX_TEXT),
    addedConcepts: entry.added_concepts.slice(0, MAX_CONCEPTS),
    removedConcepts: entry.removed_concepts.slice(0, MAX_CONCEPTS),
    keptConcepts: entry.kept_concepts.slice(0, MAX_CONCEPTS),
  }))
  const concepts = {
    added: diff.concepts.added.slice(0, MAX_LESSONS),
    removed: diff.concepts.removed.slice(0, MAX_LESSONS),
    kept: diff.concepts.kept,
  }
  const referenced = new Set([
    ...concepts.added,
    ...concepts.removed,
    ...lessons.flatMap((entry) => [...entry.addedConcepts, ...entry.removedConcepts]),
  ])
  const conceptNames: Record<string, string> = {}
  for (const id of referenced) conceptNames[id] = clip(names.get(id) ?? id, MAX_NAME)
  return {
    fromVersion: diff.from_version,
    toVersion: diff.to_version,
    lessons,
    concepts,
    summary: diff.summary,
    conceptNames,
  }
}

export function toAffectedLessonsDto(
  result: AffectedResult,
  titles: ReadonlyMap<string, string>,
): AffectedLessonsDto {
  return {
    sources: result.sources.slice(0, 50).map((source) => ({
      sourceId: source.sourceId,
      title: clip(titles.get(source.sourceId) ?? source.sourceId, MAX_TEXT),
      reason: source.reason,
    })),
    lessons: result.lessons.slice(0, MAX_LESSONS).map((lesson) => ({
      lessonId: lesson.lessonId,
      specId: lesson.specId,
      title: clip(lesson.title, MAX_TEXT),
      sourceIds: lesson.sourceIds.slice(0, 50),
      missingFragments: lesson.missingFragments,
    })),
  }
}
