import { describe, expect, it } from 'vitest'
import { asJson } from '../json'
import { versionDiffSchema } from '../regenerate/diff'
import { buildDraft, lesson, module, section } from '../testing/edit-fixtures'
import { createTreeRepos } from '../testing/tree-repos'
import { freezePath } from './freeze-path'

const clock = { now: () => new Date('2026-09-09T12:00:00.000Z') }
const completedAt = new Date('2026-09-08T00:00:00.000Z')

function world() {
  const repos = createTreeRepos(clock)
  const path = repos.seedPath()
  return { repos, path }
}

// v1: two sections, two modules, four core lessons (S01M1L1, S01M1L2, S02M1L1, S02M1L2).
function v1Draft() {
  return buildDraft({
    sections: [
      section('S01', { modules: [module('S01M1')] }),
      section('S02', { modules: [module('S02M1')] }),
    ],
  })
}

// v2: S01M1's two lessons keep their concepts but change id, title and order (should pair as
// unchanged); S02M1L1 gains a concept (changed); S02M1L2 is replaced by a lesson sharing no
// concept with anything in v1 (added), leaving the old S02M1L2 unpaired (removed).
function v2Draft() {
  return buildDraft({
    sections: [
      section('S01', {
        modules: [
          module('S01M1', {
            lessons: [
              lesson('S01M1L2-new', {
                title: 'New L2',
                concept_ids: ['c_S01M1L2_1', 'c_S01M1L2_2'],
              }),
              lesson('S01M1L1-new', {
                title: 'New L1',
                concept_ids: ['c_S01M1L1_1', 'c_S01M1L1_2'],
              }),
            ],
          }),
        ],
      }),
      section('S02', {
        modules: [
          module('S02M1', {
            lessons: [
              lesson('S02M1L1', {
                concept_ids: ['c_S02M1L1_1', 'c_S02M1L1_2', 'c_NEW_CONCEPT'],
              }),
              lesson('S02M1L2X', { concept_ids: ['c_totally_new'] }),
            ],
          }),
        ],
      }),
    ],
  })
}

describe('freezePath() — regenerating a version', () => {
  it('diffs v2 against v1, migrates progress by concept, and leaves v1 untouched', async () => {
    const { repos, path } = world()
    const v1Version = repos.seedVersion(path.id, { spec: asJson(v1Draft()) })
    await freezePath({ repos, clock }, { pathVersionId: v1Version.id })

    // Complete S01M1L1, S01M1L2 and S02M1L1 in v1; leave S02M1L2 uncompleted.
    for (const row of repos.rows.lessons) {
      if (['S01M1L1', 'S01M1L2', 'S02M1L1'].includes(row.specId)) {
        Object.assign(row, { completedAt })
      }
    }
    const v1LessonIds = new Set(repos.rows.lessons.map((l) => l.id))
    const v1LessonsBefore = repos.rows.lessons.map((l) => ({ ...l }))

    const v2Version = repos.seedVersion(path.id, { spec: asJson(v2Draft()) })
    const result = await freezePath({ repos, clock }, { pathVersionId: v2Version.id })

    expect(result.path.activeVersion).toBe(v2Version.number)
    expect(result.path.status).toBe('active')

    // The diff was computed, stored on the version row, and is schema-valid.
    expect(result.diff).not.toBeNull()
    const parsed = versionDiffSchema.parse(result.diff)
    expect(parsed.from_version).toBe(v1Version.number)
    expect(parsed.to_version).toBe(v2Version.number)
    expect(parsed.summary).toEqual({ unchanged: 2, changed: 1, added: 1, removed: 1 })
    const storedVersion = repos.rows.versions.find((v) => v.id === result.version.id)
    expect(storedVersion?.diff).toEqual(result.diff)
    expect(result.version.diff).toEqual(result.diff)

    // Migrated completion: the unchanged pair inherits completedAt; changed/added do not.
    const s01 = result.tree.sections.find((s) => s.specId === 'S01')
    const s01Lessons = s01?.modules[0]?.lessons ?? []
    const l2new = s01Lessons.find((l) => l.specId === 'S01M1L2-new')
    const l1new = s01Lessons.find((l) => l.specId === 'S01M1L1-new')
    expect(l2new?.completedAt?.getTime()).toBe(clock.now().getTime())
    expect(l1new?.completedAt?.getTime()).toBe(clock.now().getTime())

    const s02 = result.tree.sections.find((s) => s.specId === 'S02')
    const s02Lessons = s02?.modules[0]?.lessons ?? []
    const changedLesson = s02Lessons.find((l) => l.specId === 'S02M1L1')
    const addedLesson = s02Lessons.find((l) => l.specId === 'S02M1L2X')
    expect(changedLesson?.completedAt).toBeNull()
    expect(addedLesson?.completedAt).toBeNull()

    expect(result.migrated).not.toBeNull()

    // v1's rows are read-only: every field, on every v1 lesson row, is untouched.
    const v1LessonsAfter = repos.rows.lessons.filter((l) => v1LessonIds.has(l.id))
    expect(v1LessonsAfter).toEqual(v1LessonsBefore)
  })

  it('freezing the first version of a path returns a null diff and null migration, and writes no diff', async () => {
    const { repos, path } = world()
    const version = repos.seedVersion(path.id, { spec: asJson(v1Draft()) })

    const result = await freezePath({ repos, clock }, { pathVersionId: version.id })

    expect(result.diff).toBeNull()
    expect(result.migrated).toBeNull()
    expect(result.version.diff).toBeNull()
    const storedVersion = repos.rows.versions.find((v) => v.id === result.version.id)
    expect(storedVersion?.diff).toBeNull()
  })
})
