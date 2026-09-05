import type {
  Activity,
  LearningPath,
  Lesson,
  LessonStatus,
  Module,
  NewEntity,
  PathRepository,
  PathTree,
  PathVersion,
  Section,
} from '@retenia/core'
import { EntityNotFoundError } from '@retenia/core'
import { and, asc, eq, inArray, isNull, max, sql } from 'drizzle-orm'
import { activities, lessons, modules, paths, pathVersions, sections } from '../schema'
import { createBaseRepository, type Row, type TableCodec } from './base'
import type { RepositoryContext } from './context'
import {
  defined,
  toDate,
  toDateOrNull,
  toJsonArray,
  toJsonObject,
  toJsonObjectOrNull,
  toNumber,
  toNumberOrNull,
  toStringArray,
  toText,
  toTextOrNull,
} from './mapping'

const pathCodec: TableCodec<
  LearningPath,
  NewEntity<LearningPath>,
  Partial<NewEntity<LearningPath>> & { version?: number }
> = {
  table: paths,
  name: 'paths',
  toEntity: (row: Row): LearningPath => ({
    id: toText(row.id),
    title: toText(row.title),
    language: toText(row.language),
    level: toTextOrNull(row.level),
    goal: toTextOrNull(row.goal),
    targetDate: toTextOrNull(row.targetDate),
    status: row.status as LearningPath['status'],
    activeVersion: toNumberOrNull(row.activeVersion),
    sourceIds: toStringArray(row.sourceIds),
    settings: toJsonObjectOrNull(row.settings),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: toDateOrNull(row.deletedAt),
    deviceId: toText(row.deviceId),
    version: toNumber(row.version),
  }),
  toInsert: (input) =>
    defined({
      title: input.title,
      language: input.language,
      level: input.level ?? null,
      goal: input.goal ?? null,
      targetDate: input.targetDate ?? null,
      status: input.status,
      activeVersion: input.activeVersion ?? null,
      sourceIds: input.sourceIds,
      settings: input.settings ?? null,
    }),
  toUpdate: (patch) =>
    defined({
      title: patch.title,
      language: patch.language,
      level: patch.level,
      goal: patch.goal,
      targetDate: patch.targetDate,
      status: patch.status,
      activeVersion: patch.activeVersion,
      sourceIds: patch.sourceIds,
      settings: patch.settings,
    }),
}

const versionCodec: TableCodec<
  PathVersion,
  NewEntity<PathVersion>,
  Partial<NewEntity<PathVersion>> & { version?: number }
> = {
  table: pathVersions,
  name: 'path_versions',
  toEntity: (row: Row): PathVersion => ({
    id: toText(row.id),
    pathId: toText(row.pathId),
    number: toNumber(row.number),
    spec: toJsonObject(row.spec),
    knowledgeGraph: toJsonObjectOrNull(row.knowledgeGraph),
    manifest: toJsonObjectOrNull(row.manifest),
    diff: toJsonObjectOrNull(row.diff),
    frozenAt: toDateOrNull(row.frozenAt),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: toDateOrNull(row.deletedAt),
    deviceId: toText(row.deviceId),
    version: toNumber(row.version),
  }),
  toInsert: (input) =>
    defined({
      pathId: input.pathId,
      number: input.number,
      spec: input.spec,
      knowledgeGraph: input.knowledgeGraph ?? null,
      manifest: input.manifest ?? null,
      diff: input.diff ?? null,
      frozenAt:
        input.frozenAt === null || input.frozenAt === undefined ? null : input.frozenAt.getTime(),
    }),
  toUpdate: (patch) =>
    defined({
      spec: patch.spec,
      knowledgeGraph: patch.knowledgeGraph,
      manifest: patch.manifest,
      diff: patch.diff,
      frozenAt: patch.frozenAt === undefined ? undefined : (patch.frozenAt?.getTime() ?? null),
    }),
}

const sectionCodec: TableCodec<
  Section,
  NewEntity<Section>,
  Partial<NewEntity<Section>> & { version?: number }
> = {
  table: sections,
  name: 'sections',
  toEntity: (row: Row): Section => ({
    id: toText(row.id),
    pathVersionId: toText(row.pathVersionId),
    ordinal: toNumber(row.ordinal),
    specId: toText(row.specId),
    title: toText(row.title),
    unlockRule: toJsonObjectOrNull(row.unlockRule),
    xpReward: toNumber(row.xpReward),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: toDateOrNull(row.deletedAt),
    deviceId: toText(row.deviceId),
    version: toNumber(row.version),
  }),
  toInsert: (input) =>
    defined({
      pathVersionId: input.pathVersionId,
      ordinal: input.ordinal,
      specId: input.specId,
      title: input.title,
      unlockRule: input.unlockRule ?? null,
      xpReward: input.xpReward,
    }),
  toUpdate: (patch) =>
    defined({
      ordinal: patch.ordinal,
      specId: patch.specId,
      title: patch.title,
      unlockRule: patch.unlockRule,
      xpReward: patch.xpReward,
    }),
}

const moduleCodec: TableCodec<
  Module,
  NewEntity<Module>,
  Partial<NewEntity<Module>> & { version?: number }
> = {
  table: modules,
  name: 'modules',
  toEntity: (row: Row): Module => ({
    id: toText(row.id),
    sectionId: toText(row.sectionId),
    ordinal: toNumber(row.ordinal),
    specId: toText(row.specId),
    title: toText(row.title),
    objectives: toJsonArray(row.objectives),
    diagnosticItemIds: toStringArray(row.diagnosticItemIds),
    unlockRule: toJsonObjectOrNull(row.unlockRule),
    xpReward: toNumber(row.xpReward),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: toDateOrNull(row.deletedAt),
    deviceId: toText(row.deviceId),
    version: toNumber(row.version),
  }),
  toInsert: (input) =>
    defined({
      sectionId: input.sectionId,
      ordinal: input.ordinal,
      specId: input.specId,
      title: input.title,
      objectives: input.objectives,
      diagnosticItemIds: input.diagnosticItemIds,
      unlockRule: input.unlockRule ?? null,
      xpReward: input.xpReward,
    }),
  toUpdate: (patch) =>
    defined({
      ordinal: patch.ordinal,
      specId: patch.specId,
      title: patch.title,
      objectives: patch.objectives,
      diagnosticItemIds: patch.diagnosticItemIds,
      unlockRule: patch.unlockRule,
      xpReward: patch.xpReward,
    }),
}

const lessonCodec: TableCodec<
  Lesson,
  NewEntity<Lesson>,
  Partial<NewEntity<Lesson>> & { version?: number }
> = {
  table: lessons,
  name: 'lessons',
  toEntity: (row: Row): Lesson => ({
    id: toText(row.id),
    moduleId: toText(row.moduleId),
    ordinal: toNumber(row.ordinal),
    specId: toText(row.specId),
    kind: row.kind as Lesson['kind'],
    parentLessonId: toTextOrNull(row.parentLessonId),
    title: toText(row.title),
    status: row.status as LessonStatus,
    objectives: toJsonArray(row.objectives),
    conceptIds: toStringArray(row.conceptIds),
    prerequisiteLessonIds: toStringArray(row.prerequisiteLessonIds),
    estimatedMinutes: toNumberOrNull(row.estimatedMinutes),
    theory: toJsonObjectOrNull(row.theory),
    citations: toJsonArray(row.citations),
    qa: toJsonObjectOrNull(row.qa),
    remediation: toJsonObjectOrNull(row.remediation),
    unlockRule: toJsonObjectOrNull(row.unlockRule),
    xpReward: toNumber(row.xpReward),
    completedAt: toDateOrNull(row.completedAt),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: toDateOrNull(row.deletedAt),
    deviceId: toText(row.deviceId),
    version: toNumber(row.version),
  }),
  toInsert: (input) =>
    defined({
      moduleId: input.moduleId,
      ordinal: input.ordinal,
      specId: input.specId,
      kind: input.kind,
      parentLessonId: input.parentLessonId ?? null,
      title: input.title,
      status: input.status,
      objectives: input.objectives,
      conceptIds: input.conceptIds,
      prerequisiteLessonIds: input.prerequisiteLessonIds,
      estimatedMinutes: input.estimatedMinutes ?? null,
      theory: input.theory ?? null,
      citations: input.citations,
      qa: input.qa ?? null,
      remediation: input.remediation ?? null,
      unlockRule: input.unlockRule ?? null,
      xpReward: input.xpReward,
      completedAt:
        input.completedAt === null || input.completedAt === undefined
          ? null
          : input.completedAt.getTime(),
    }),
  toUpdate: (patch) =>
    defined({
      ordinal: patch.ordinal,
      specId: patch.specId,
      kind: patch.kind,
      parentLessonId: patch.parentLessonId,
      title: patch.title,
      status: patch.status,
      objectives: patch.objectives,
      conceptIds: patch.conceptIds,
      prerequisiteLessonIds: patch.prerequisiteLessonIds,
      estimatedMinutes: patch.estimatedMinutes,
      theory: patch.theory,
      citations: patch.citations,
      qa: patch.qa,
      remediation: patch.remediation,
      unlockRule: patch.unlockRule,
      xpReward: patch.xpReward,
      completedAt:
        patch.completedAt === undefined ? undefined : (patch.completedAt?.getTime() ?? null),
    }),
}

const activityCodec: TableCodec<
  Activity,
  NewEntity<Activity>,
  Partial<NewEntity<Activity>> & { version?: number }
> = {
  table: activities,
  name: 'activities',
  toEntity: (row: Row): Activity => ({
    id: toText(row.id),
    lessonId: toTextOrNull(row.lessonId),
    ordinal: toNumberOrNull(row.ordinal),
    type: toText(row.type),
    family: row.family as Activity['family'],
    schemaVersion: toNumber(row.schemaVersion),
    lang: toText(row.lang),
    bloom: toTextOrNull(row.bloom) as Activity['bloom'],
    difficulty: toNumberOrNull(row.difficulty),
    conceptIds: toStringArray(row.conceptIds),
    misconceptionIds: toStringArray(row.misconceptionIds),
    config: toJsonObject(row.config),
    grading: toJsonObject(row.grading),
    status: row.status as Activity['status'],
    sourceRefs: toJsonArray(row.sourceRefs),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: toDateOrNull(row.deletedAt),
    deviceId: toText(row.deviceId),
    version: toNumber(row.version),
  }),
  toInsert: (input) =>
    defined({
      lessonId: input.lessonId ?? null,
      ordinal: input.ordinal ?? null,
      type: input.type,
      family: input.family,
      schemaVersion: input.schemaVersion,
      lang: input.lang,
      bloom: input.bloom ?? null,
      difficulty: input.difficulty ?? null,
      conceptIds: input.conceptIds,
      misconceptionIds: input.misconceptionIds,
      config: input.config,
      grading: input.grading,
      status: input.status,
      sourceRefs: input.sourceRefs,
    }),
  toUpdate: (patch) =>
    defined({
      lessonId: patch.lessonId,
      ordinal: patch.ordinal,
      type: patch.type,
      family: patch.family,
      schemaVersion: patch.schemaVersion,
      lang: patch.lang,
      bloom: patch.bloom,
      difficulty: patch.difficulty,
      conceptIds: patch.conceptIds,
      misconceptionIds: patch.misconceptionIds,
      config: patch.config,
      grading: patch.grading,
      status: patch.status,
      sourceRefs: patch.sourceRefs,
    }),
}

export function createPathRepository(ctx: RepositoryContext): PathRepository {
  const base = createBaseRepository(ctx, pathCodec)
  const versions = createBaseRepository(ctx, versionCodec)
  const sectionRepo = createBaseRepository(ctx, sectionCodec)
  const moduleRepo = createBaseRepository(ctx, moduleCodec)
  const lessonRepo = createBaseRepository(ctx, lessonCodec)
  const activityRepo = createBaseRepository(ctx, activityCodec)

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

    listByStatus: (status, options) =>
      base.findWhere(eq(paths.status, status), {
        ...options,
        orderBy: [asc(paths.createdAt), asc(paths.id)],
      }),

    setActiveVersion: async (pathId, number) =>
      ctx.run(async () => {
        const rows = await versions.findWhere(
          and(eq(pathVersions.pathId, pathId), eq(pathVersions.number, number)),
        )
        if (rows[0] === undefined) {
          throw new EntityNotFoundError('path_versions', `${pathId}#${number}`)
        }
        return base.updateColumns(pathId, { activeVersion: number })
      }),

    findVersion: versions.findById,

    findVersionByNumber: async (pathId, number) =>
      (
        await versions.findWhere(
          and(eq(pathVersions.pathId, pathId), eq(pathVersions.number, number)),
        )
      )[0],

    listVersions: (pathId, options) =>
      versions.findWhere(eq(pathVersions.pathId, pathId), {
        ...options,
        orderBy: [asc(pathVersions.number)],
      }),

    /** Takes the next free `number` when the caller does not pin one, inside the
     *  transaction so two concurrent generations cannot collide on the unique index. */
    createVersion: async (input) =>
      ctx.run(async () => {
        if (input.number !== undefined) {
          return versions.create({ ...input, number: input.number })
        }
        const rows = ctx.db
          .select({ highest: max(pathVersions.number) })
          .from(pathVersions)
          .where(eq(pathVersions.pathId, input.pathId))
          .all() as Array<{ highest: number | null }>
        return versions.create({ ...input, number: (rows[0]?.highest ?? 0) + 1 })
      }),

    freezeVersion: (versionId, at) => versions.updateColumns(versionId, { frozenAt: at.getTime() }),

    loadTree: async (versionId): Promise<PathTree | undefined> => {
      const version = await versions.findById(versionId)
      if (version === undefined) return undefined
      const path = await base.findById(version.pathId)
      if (path === undefined) return undefined

      const versionSections = await sectionRepo.findWhere(eq(sections.pathVersionId, versionId), {
        orderBy: [asc(sections.ordinal), asc(sections.id)],
      })
      const sectionIds = versionSections.map((section) => section.id)
      const versionModules =
        sectionIds.length === 0
          ? []
          : await moduleRepo.findWhere(inArray(modules.sectionId, sectionIds), {
              orderBy: [asc(modules.ordinal), asc(modules.id)],
            })
      const moduleIds = versionModules.map((module) => module.id)
      const versionLessons =
        moduleIds.length === 0
          ? []
          : await lessonRepo.findWhere(inArray(lessons.moduleId, moduleIds), {
              orderBy: [asc(lessons.ordinal), asc(lessons.id)],
            })
      const lessonIds = versionLessons.map((lesson) => lesson.id)
      const versionActivities =
        lessonIds.length === 0
          ? []
          : await activityRepo.findWhere(inArray(activities.lessonId, lessonIds), {
              orderBy: [asc(activities.ordinal), asc(activities.id)],
            })

      const activitiesByLesson = new Map<string, Activity[]>()
      for (const activity of versionActivities) {
        if (activity.lessonId === null) continue
        const bucket = activitiesByLesson.get(activity.lessonId) ?? []
        bucket.push(activity)
        activitiesByLesson.set(activity.lessonId, bucket)
      }
      const lessonsByModule = new Map<string, Array<Lesson & { activities: Activity[] }>>()
      for (const lesson of versionLessons) {
        const bucket = lessonsByModule.get(lesson.moduleId) ?? []
        bucket.push({ ...lesson, activities: activitiesByLesson.get(lesson.id) ?? [] })
        lessonsByModule.set(lesson.moduleId, bucket)
      }
      const modulesBySection = new Map<
        string,
        Array<Module & { lessons: Array<Lesson & { activities: Activity[] }> }>
      >()
      for (const module of versionModules) {
        const bucket = modulesBySection.get(module.sectionId) ?? []
        bucket.push({ ...module, lessons: lessonsByModule.get(module.id) ?? [] })
        modulesBySection.set(module.sectionId, bucket)
      }

      return {
        path,
        version,
        sections: versionSections.map((section) => ({
          ...section,
          modules: modulesBySection.get(section.id) ?? [],
        })),
      }
    },

    findSection: sectionRepo.findById,
    listSections: (pathVersionId, options) =>
      sectionRepo.findWhere(eq(sections.pathVersionId, pathVersionId), {
        ...options,
        orderBy: [asc(sections.ordinal), asc(sections.id)],
      }),
    createSection: sectionRepo.create,
    updateSection: sectionRepo.update,

    findModule: moduleRepo.findById,
    listModules: (sectionId, options) =>
      moduleRepo.findWhere(eq(modules.sectionId, sectionId), {
        ...options,
        orderBy: [asc(modules.ordinal), asc(modules.id)],
      }),
    createModule: moduleRepo.create,
    updateModule: moduleRepo.update,

    findLesson: lessonRepo.findById,

    findLessonBySpecId: async (pathVersionId, specId) => {
      const rows = ctx.db
        .select({ lesson: lessons })
        .from(lessons)
        .innerJoin(modules, eq(lessons.moduleId, modules.id))
        .innerJoin(sections, eq(modules.sectionId, sections.id))
        .where(
          and(
            eq(sections.pathVersionId, pathVersionId),
            eq(lessons.specId, specId),
            isNull(lessons.deletedAt),
          ),
        )
        .all() as Array<{ lesson: Row }>
      const row = rows[0]
      return row === undefined ? undefined : lessonCodec.toEntity(row.lesson)
    },

    listLessons: (moduleId, options) =>
      lessonRepo.findWhere(eq(lessons.moduleId, moduleId), {
        ...options,
        orderBy: [asc(lessons.ordinal), asc(lessons.id)],
      }),

    listLessonsByStatus: async (pathVersionId, status, options) => {
      let query = ctx.db
        .select({ lesson: lessons })
        .from(lessons)
        .innerJoin(modules, eq(lessons.moduleId, modules.id))
        .innerJoin(sections, eq(modules.sectionId, sections.id))
        .where(
          and(
            eq(sections.pathVersionId, pathVersionId),
            eq(lessons.status, status),
            isNull(lessons.deletedAt),
          ),
        )
        .orderBy(asc(lessons.ordinal), asc(lessons.id))
        .$dynamic()
      if (options?.limit !== undefined) query = query.limit(options.limit)
      if (options?.offset !== undefined) query = query.offset(options.offset)
      return (query.all() as Array<{ lesson: Row }>).map((row) => lessonCodec.toEntity(row.lesson))
    },

    createLesson: lessonRepo.create,
    updateLesson: lessonRepo.update,
    softDeleteLesson: lessonRepo.softDelete,

    findActivity: activityRepo.findById,
    findActivities: activityRepo.findMany,
    listActivities: (lessonId, options) =>
      activityRepo.findWhere(eq(activities.lessonId, lessonId), {
        ...options,
        orderBy: [asc(activities.ordinal), asc(activities.id)],
      }),
    listActivitiesByConcepts: (conceptIds, options) => {
      if (conceptIds.length === 0) return Promise.resolve([])
      // `concept_ids` is a JSON array in one column, so membership is an EXISTS over
      // `json_each` rather than an `IN`. The correlated subquery is what lets one activity
      // match on any of its concepts without the row being returned once per match.
      const placeholders = sql.join(
        conceptIds.map((id) => sql`${id}`),
        sql`, `,
      )
      const matchesConcept = sql`exists (
        select 1 from json_each(${activities.conceptIds})
        where json_each.value in (${placeholders})
      )`
      return activityRepo.findWhere(and(matchesConcept, eq(activities.status, 'ready')), {
        ...options,
        orderBy: [asc(activities.id)],
      })
    },
    createActivity: activityRepo.create,
    createActivities: activityRepo.createMany,
    updateActivity: activityRepo.update,
    softDeleteActivity: activityRepo.softDelete,
  }
}
