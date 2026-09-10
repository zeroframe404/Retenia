import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OpenedDatabase } from '../open-database'
import { openTestDatabase, TEST_DEVICE_ID, testClock, testIds } from '../testing'
import { createRepositories } from './index'

/**
 * The `paths` repository (sub-phase 8.1's schema, sub-phase 8.2's write path): the
 * `paths`/`path_versions` aggregate and the version-owned tree, end to end —
 * `docs/spec/04-path-generation.md` §7–§8, `docs/spec/07a-schema.md` "Learning paths".
 *
 * Nothing here exercised `createPathRepository` before 8.2: sub-phase 8.1 only ever drove it
 * through `packages/pathgen`'s in-memory fakes.
 */

function seedPath(repos: ReturnType<typeof createRepositories>) {
  return repos.paths.create({
    title: 'Física I',
    language: 'es-AR',
    level: 'undergraduate',
    goal: 'Aprobar el parcial',
    targetDate: null,
    status: 'draft',
    activeVersion: null,
    sourceIds: ['src-1'],
    settings: null,
  })
}

describe('path repository', () => {
  let opened: OpenedDatabase
  let repos: ReturnType<typeof createRepositories>
  const clock = testClock()

  beforeEach(() => {
    opened = openTestDatabase()
    repos = createRepositories(opened, { deviceId: TEST_DEVICE_ID, clock, ids: testIds(clock) })
  })
  afterEach(() => opened.close())

  it('creates an auto-numbered version and updates its spec while unfrozen', async () => {
    const path = await seedPath(repos)
    const v1 = await repos.paths.createVersion({
      pathId: path.id,
      spec: { kind: 'draft', title: 'v1' },
      knowledgeGraph: null,
      manifest: null,
      diff: null,
      frozenAt: null,
    })
    expect(v1.number).toBe(1)
    expect(v1.frozenAt).toBeNull()

    const v2 = await repos.paths.createVersion({
      pathId: path.id,
      spec: { kind: 'draft', title: 'v2' },
      knowledgeGraph: null,
      manifest: null,
      diff: null,
      frozenAt: null,
    })
    expect(v2.number).toBe(2)

    const updated = await repos.paths.updateVersion(v1.id, {
      spec: { kind: 'draft', title: 'v1 renamed' },
    })
    expect(updated.spec).toEqual({ kind: 'draft', title: 'v1 renamed' })
    expect(updated.frozenAt).toBeNull()

    const reloaded = await repos.paths.findVersion(v1.id)
    expect(reloaded?.spec).toEqual({ kind: 'draft', title: 'v1 renamed' })
  })

  it('freezes a version, sets it active, and builds the tree in order', async () => {
    const path = await seedPath(repos)
    const version = await repos.paths.createVersion({
      pathId: path.id,
      spec: { kind: 'draft' },
      knowledgeGraph: null,
      manifest: null,
      diff: null,
      frozenAt: null,
    })

    const section = await repos.paths.createSection({
      pathVersionId: version.id,
      ordinal: 0,
      specId: 'S01',
      title: 'Cinemática',
      unlockRule: null,
      xpReward: 0,
    })
    const module = await repos.paths.createModule({
      sectionId: section.id,
      ordinal: 0,
      specId: 'M01',
      title: 'Movimiento rectilíneo',
      objectives: [],
      diagnosticItemIds: [],
      unlockRule: null,
      xpReward: 0,
    })
    const lesson1 = await repos.paths.createLesson({
      moduleId: module.id,
      ordinal: 0,
      specId: 'L01',
      kind: 'core',
      parentLessonId: null,
      title: 'Velocidad',
      status: 'pending',
      objectives: [],
      conceptIds: ['c1'],
      prerequisiteLessonIds: [],
      estimatedMinutes: 8,
      theory: null,
      citations: [],
      qa: null,
      remediation: null,
      unlockRule: null,
      xpReward: 0,
      completedAt: null,
    })
    await repos.paths.createLesson({
      moduleId: module.id,
      ordinal: 1,
      specId: 'M01.reinf',
      kind: 'reinforcement',
      parentLessonId: null,
      title: 'Repaso',
      status: 'pending',
      objectives: [],
      conceptIds: ['c1'],
      prerequisiteLessonIds: [lesson1.id],
      estimatedMinutes: 10,
      theory: null,
      citations: [],
      qa: null,
      remediation: null,
      unlockRule: null,
      xpReward: 0,
      completedAt: null,
    })

    const frozen = await repos.paths.freezeVersion(version.id, clock.now())
    expect(frozen.frozenAt).not.toBeNull()

    const activated = await repos.paths.setActiveVersion(path.id, version.number)
    expect(activated.activeVersion).toBe(version.number)

    const tree = await repos.paths.loadTree(version.id)
    expect(tree?.sections).toHaveLength(1)
    expect(tree?.sections[0]?.modules).toHaveLength(1)
    expect(tree?.sections[0]?.modules[0]?.lessons.map((l) => l.specId)).toEqual([
      'L01',
      'M01.reinf',
    ])
  })

  it('rejects setting an active version that does not exist', async () => {
    const path = await seedPath(repos)
    await expect(repos.paths.setActiveVersion(path.id, 99)).rejects.toThrow()
  })
})
