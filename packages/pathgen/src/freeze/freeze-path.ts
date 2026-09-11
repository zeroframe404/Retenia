import type {
  Clock,
  KnowledgeItemRepository,
  LearningPath,
  PathRepository,
  PathTree,
  PathVersion,
} from '@retenia/core'
import { GenerationError } from '../errors'
import { asJson } from '../json'
import { diffDrafts, type VersionDiff } from '../regenerate/diff'
import {
  applyProgressMigration,
  type MigrationItem,
  type MigrationLesson,
  type MigrationSummary,
  planProgressMigration,
} from '../regenerate/migrate'
import { type PathDraft, pathDraftSchema } from '../schemas/path-draft'

/**
 * Freezing a `PathDraft.v1` into the relational tree
 * (`docs/spec/04-path-generation.md` §3 stage 6, §7–§8; sub-phase 8.2's "Confirmar ruta").
 *
 * Materializes every section, module and lesson (core lessons, then a `reinforcement`-kind
 * row, then a `checkpoint`-kind row when the module has one) in draft order, sets `frozen_at`,
 * points `paths.active_version` at the new version and moves `paths.status` to `active`. The
 * final exam blueprint stays inside `path_versions.spec` — a dedicated `exams` row is a later
 * sub-phase's job (10.x), not this one's.
 *
 * `known_node_ids` (§13 step 3's "ya lo sé") becomes `lessons.completed_at`: every lesson under
 * a known section or module is frozen already completed. Real FSRS low-priority seeding needs
 * the memory system's item creation and stays the diagnostic's `seed_memory` TODO (8.5).
 *
 * **Freezing a regeneration** (sub-phase 8.6, §7 "Regenerar = nueva PathSpec.version con diff
 * por lección; el progreso migra por concept_id"): when the path already has an active version,
 * the new one is compared with it lesson by lesson (`regenerate/diff.ts`, stored in
 * `path_versions.diff`) and inherits its progress by concept (`regenerate/migrate.ts`) before it
 * becomes the active version. The previous version's rows are only ever read.
 */

export interface FreezeRepos {
  readonly paths: Pick<
    PathRepository,
    | 'findVersion'
    | 'findVersionByNumber'
    | 'findById'
    | 'update'
    | 'updateVersion'
    | 'createSection'
    | 'createModule'
    | 'createLesson'
    | 'updateLesson'
    | 'freezeVersion'
    | 'setActiveVersion'
    | 'loadTree'
  >
  /** Where the previous version's cards hang. Absent means completion still migrates and the
   *  cards simply stay attached to the lessons they were written for. */
  readonly knowledgeItems?: Pick<KnowledgeItemRepository, 'listByLesson' | 'update'>
}

export interface FreezeDeps {
  readonly repos: FreezeRepos
  readonly clock: Clock
}

export interface FreezeInput {
  readonly pathVersionId: string
}

export interface FreezeResult {
  readonly path: LearningPath
  readonly version: PathVersion
  readonly tree: PathTree
  /** Against the version that was active, when this freeze replaced one. */
  readonly diff: VersionDiff | null
  readonly migrated: MigrationSummary | null
}

function readDraft(version: PathVersion): PathDraft {
  return pathDraftSchema.parse(version.spec)
}

function migrationLessons(tree: PathTree): MigrationLesson[] {
  return tree.sections.flatMap((section) =>
    section.modules.flatMap((module) =>
      module.lessons.map((lesson) => ({
        id: lesson.id,
        kind: lesson.kind,
        conceptIds: lesson.conceptIds,
        completed: lesson.completedAt !== null,
      })),
    ),
  )
}

/** The previous active version's diff and progress, carried into the one just materialized. */
async function inherit(
  deps: FreezeDeps,
  previous: PathVersion,
  next: PathVersion,
  draft: PathDraft,
  now: Date,
): Promise<{ diff: VersionDiff | null; migrated: MigrationSummary | null }> {
  const previousDraft = pathDraftSchema.safeParse(previous.spec)
  const diff = previousDraft.success
    ? diffDrafts(previousDraft.data, draft, { from: previous.number, to: next.number })
    : null
  const [before, after] = await Promise.all([
    deps.repos.paths.loadTree(previous.id),
    deps.repos.paths.loadTree(next.id),
  ])
  if (before === undefined || after === undefined) return { diff, migrated: null }

  const previousLessons = migrationLessons(before)
  const items: MigrationItem[] = []
  if (deps.repos.knowledgeItems !== undefined) {
    for (const lesson of previousLessons) {
      items.push(...(await deps.repos.knowledgeItems.listByLesson(lesson.id)))
    }
  }
  const nextLessons = migrationLessons(after)
  const plan = planProgressMigration({ previous: previousLessons, next: nextLessons, items })
  // "Ya lo sé" may already have completed some of them; completing twice would move the date.
  const alreadyDone = new Set(nextLessons.filter((lesson) => lesson.completed).map((l) => l.id))
  const migrated = await applyProgressMigration(
    deps.repos,
    { ...plan, complete: plan.complete.filter((id) => !alreadyDone.has(id)) },
    items,
    now,
  )
  return { diff, migrated }
}

export async function freezePath(deps: FreezeDeps, input: FreezeInput): Promise<FreezeResult> {
  const version = await deps.repos.paths.findVersion(input.pathVersionId)
  if (version === undefined) {
    throw new GenerationError('version_not_found', `no path version "${input.pathVersionId}"`)
  }
  if (version.frozenAt !== null) {
    throw new GenerationError(
      'already_frozen',
      `path version "${input.pathVersionId}" is already frozen`,
    )
  }
  const path = await deps.repos.paths.findById(version.pathId)
  if (path === undefined) {
    throw new GenerationError('path_not_found', `no path "${version.pathId}"`)
  }

  const draft = readDraft(version)
  const known = new Set(draft.known_node_ids)
  const now = deps.clock.now()

  for (const [sectionIndex, section] of draft.sections.entries()) {
    const sectionRow = await deps.repos.paths.createSection({
      pathVersionId: version.id,
      ordinal: sectionIndex,
      specId: section.id,
      title: section.title,
      unlockRule: null,
      xpReward: 0,
    })
    const sectionKnown = known.has(section.id)

    for (const [moduleIndex, module] of section.modules.entries()) {
      const moduleRow = await deps.repos.paths.createModule({
        sectionId: sectionRow.id,
        ordinal: moduleIndex,
        specId: module.id,
        title: module.title,
        objectives: module.objectives,
        diagnosticItemIds: [],
        unlockRule: null,
        xpReward: 0,
      })
      const completedAt = sectionKnown || known.has(module.id) ? now : null

      let ordinal = 0
      for (const lesson of module.lessons) {
        await deps.repos.paths.createLesson({
          moduleId: moduleRow.id,
          ordinal: ordinal++,
          specId: lesson.id,
          kind: 'core',
          parentLessonId: null,
          title: lesson.title,
          status: 'pending',
          objectives: lesson.objectives,
          conceptIds: lesson.concept_ids,
          prerequisiteLessonIds: lesson.prerequisite_lesson_ids,
          estimatedMinutes: lesson.estimated_minutes,
          theory: null,
          citations: [],
          qa: null,
          expansion: null,
          remediation: null,
          unlockRule: null,
          xpReward: 0,
          completedAt,
        })
      }

      await deps.repos.paths.createLesson({
        moduleId: moduleRow.id,
        ordinal: ordinal++,
        specId: module.reinforcement.id,
        kind: 'reinforcement',
        parentLessonId: null,
        title: 'Reinforcement',
        status: 'pending',
        objectives: [],
        conceptIds: module.reinforcement.concept_ids,
        prerequisiteLessonIds: [],
        estimatedMinutes: module.reinforcement.estimated_minutes,
        theory: null,
        citations: [],
        qa: null,
        expansion: null,
        remediation: null,
        unlockRule: null,
        xpReward: 0,
        completedAt,
      })

      if (module.checkpoint !== null) {
        await deps.repos.paths.createLesson({
          moduleId: moduleRow.id,
          ordinal: ordinal++,
          specId: module.checkpoint.id,
          kind: 'checkpoint',
          parentLessonId: null,
          title: 'Checkpoint',
          status: 'pending',
          objectives: [],
          conceptIds: module.checkpoint.concept_ids,
          prerequisiteLessonIds: [],
          estimatedMinutes: module.checkpoint.estimated_minutes,
          theory: null,
          citations: [],
          qa: null,
          expansion: null,
          remediation: null,
          unlockRule: null,
          xpReward: 0,
          completedAt,
        })
      }
    }
  }

  let frozen = await deps.repos.paths.freezeVersion(version.id, now)

  // A regeneration: the version being studied until now hands over its progress.
  const previous =
    path.activeVersion === null || path.activeVersion === frozen.number
      ? undefined
      : await deps.repos.paths.findVersionByNumber(path.id, path.activeVersion)
  let diff: VersionDiff | null = null
  let migrated: MigrationSummary | null = null
  if (previous !== undefined && previous.frozenAt !== null) {
    const inherited = await inherit(deps, previous, frozen, draft, now)
    diff = inherited.diff
    migrated = inherited.migrated
    if (diff !== null)
      frozen = await deps.repos.paths.updateVersion(frozen.id, { diff: asJson(diff) })
  }

  await deps.repos.paths.setActiveVersion(path.id, frozen.number)
  const updatedPath = await deps.repos.paths.update(path.id, {
    status: 'active',
    // A regeneration left the studied path's own fields alone until now (`generation-run.ts`).
    ...(previous === undefined
      ? {}
      : {
          title: draft.title,
          language: draft.language,
          level: draft.level,
          goal: draft.goal,
          targetDate: draft.target_date,
        }),
  })
  const tree = await deps.repos.paths.loadTree(frozen.id)
  if (tree === undefined) {
    throw new GenerationError(
      'version_not_found',
      'the frozen version disappeared while loading its tree',
    )
  }

  return { path: updatedPath, version: frozen, tree, diff, migrated }
}
