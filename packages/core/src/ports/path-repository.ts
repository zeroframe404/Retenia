import type {
  Activity,
  LearningPath,
  Lesson,
  LessonStatus,
  Module,
  PathStatus,
  PathVersion,
  Section,
} from '../entities'
import type { CrudRepository, EntityPatch, ListOptions, NewEntity } from './audit'

/** A whole frozen generation, loaded in one go for the path map and the lesson player. */
export interface PathTree {
  path: LearningPath
  version: PathVersion
  sections: Array<
    Section & {
      modules: Array<Module & { lessons: Array<Lesson & { activities: Activity[] }> }>
    }
  >
}

/**
 * The path aggregate: `paths`, their `path_versions`, and the version-owned tree
 * sections → modules → lessons → activities.
 *
 * One repository rather than six because a version and its tree are written together and
 * frozen together — splitting them would let a half-written version become visible
 * (`docs/spec/04-path-generation.md` §8).
 */
export interface PathRepository extends CrudRepository<LearningPath> {
  listByStatus(status: PathStatus, options?: ListOptions): Promise<LearningPath[]>
  /** Points `activeVersion` at an existing, frozen version number. */
  setActiveVersion(pathId: string, number: number): Promise<LearningPath>

  // --- versions ---
  findVersion(id: string): Promise<PathVersion | undefined>
  findVersionByNumber(pathId: string, number: number): Promise<PathVersion | undefined>
  listVersions(pathId: string, options?: ListOptions): Promise<PathVersion[]>
  /** Takes the next free `number` for the path. */
  createVersion(
    input: Omit<NewEntity<PathVersion>, 'number'> & { number?: number },
  ): Promise<PathVersion>
  /** Sets `frozenAt`. A frozen version's tree is not edited again — regeneration makes a
   *  new version (`docs/spec/01-decisions.md` §3). */
  freezeVersion(versionId: string, at: Date): Promise<PathVersion>
  /** The whole tree of one version, ordered by `ordinal` at every level. */
  loadTree(versionId: string): Promise<PathTree | undefined>

  // --- tree nodes ---
  findSection(id: string): Promise<Section | undefined>
  listSections(pathVersionId: string, options?: ListOptions): Promise<Section[]>
  createSection(input: NewEntity<Section>): Promise<Section>
  updateSection(id: string, patch: EntityPatch<Section>): Promise<Section>

  findModule(id: string): Promise<Module | undefined>
  listModules(sectionId: string, options?: ListOptions): Promise<Module[]>
  createModule(input: NewEntity<Module>): Promise<Module>
  updateModule(id: string, patch: EntityPatch<Module>): Promise<Module>

  findLesson(id: string): Promise<Lesson | undefined>
  findLessonBySpecId(pathVersionId: string, specId: string): Promise<Lesson | undefined>
  listLessons(moduleId: string, options?: ListOptions): Promise<Lesson[]>
  listLessonsByStatus(
    pathVersionId: string,
    status: LessonStatus,
    options?: ListOptions,
  ): Promise<Lesson[]>
  createLesson(input: NewEntity<Lesson>): Promise<Lesson>
  /** The expansion pipeline writes one lesson at a time so a long run can resume. */
  updateLesson(id: string, patch: EntityPatch<Lesson>): Promise<Lesson>
  softDeleteLesson(id: string): Promise<void>

  findActivity(id: string): Promise<Activity | undefined>
  findActivities(ids: readonly string[]): Promise<Activity[]>
  listActivities(lessonId: string, options?: ListOptions): Promise<Activity[]>
  createActivity(input: NewEntity<Activity>): Promise<Activity>
  createActivities(inputs: readonly NewEntity<Activity>[]): Promise<Activity[]>
  updateActivity(id: string, patch: EntityPatch<Activity>): Promise<Activity>
  softDeleteActivity(id: string): Promise<void>
}
