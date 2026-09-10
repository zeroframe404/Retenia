import type { Clock, LearningPath, PathRepository, PathTree, PathVersion } from '@retenia/core'
import { GenerationError } from '../errors'
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
 */

export interface FreezeRepos {
  readonly paths: Pick<
    PathRepository,
    | 'findVersion'
    | 'findById'
    | 'update'
    | 'createSection'
    | 'createModule'
    | 'createLesson'
    | 'freezeVersion'
    | 'setActiveVersion'
    | 'loadTree'
  >
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
}

function readDraft(version: PathVersion): PathDraft {
  return pathDraftSchema.parse(version.spec)
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

  const frozen = await deps.repos.paths.freezeVersion(version.id, now)
  await deps.repos.paths.setActiveVersion(path.id, frozen.number)
  const updatedPath = await deps.repos.paths.update(path.id, { status: 'active' })
  const tree = await deps.repos.paths.loadTree(frozen.id)
  if (tree === undefined) {
    throw new GenerationError(
      'version_not_found',
      'the frozen version disappeared while loading its tree',
    )
  }

  return { path: updatedPath, version: frozen, tree }
}
