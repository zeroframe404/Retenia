import { describe, expect, it } from 'vitest'
import { asJson } from '../json'
import { buildDraft, module, section } from '../testing/edit-fixtures'
import { createTreeRepos } from '../testing/tree-repos'
import { freezePath } from './freeze-path'

const clock = { now: () => new Date('2026-09-09T12:00:00.000Z') }

function world() {
  const repos = createTreeRepos(clock)
  const path = repos.seedPath()
  return { repos, path }
}

describe('freezePath()', () => {
  it('materializes sections, modules, core lessons, reinforcement and checkpoint rows in order', async () => {
    const { repos, path } = world()
    const draft = buildDraft({
      sections: [
        section('S01', {
          modules: [
            module('S01M1', {
              checkpoint: {
                id: 'C01',
                kind: 'checkpoint',
                module_ids: ['S01M1'],
                concept_ids: ['c_extra'],
                item_count: 5,
                estimated_minutes: 15,
              },
            }),
          ],
        }),
      ],
    })
    const version = repos.seedVersion(path.id, { spec: asJson(draft) })

    const result = await freezePath({ repos, clock }, { pathVersionId: version.id })

    expect(result.version.frozenAt).toEqual(clock.now())
    expect(result.path.status).toBe('active')
    expect(result.path.activeVersion).toBe(version.number)

    expect(result.tree.sections).toHaveLength(1)
    const [treeSection] = result.tree.sections
    expect(treeSection?.specId).toBe('S01')
    expect(treeSection?.modules).toHaveLength(1)
    const [treeModule] = treeSection?.modules ?? []
    expect(treeModule?.specId).toBe('S01M1')
    expect(treeModule?.lessons.map((l) => ({ specId: l.specId, kind: l.kind }))).toEqual([
      { specId: 'S01M1L1', kind: 'core' },
      { specId: 'S01M1L2', kind: 'core' },
      { specId: 'S01M1.reinf', kind: 'reinforcement' },
      { specId: 'C01', kind: 'checkpoint' },
    ])
    expect(treeModule?.lessons.every((l) => l.completedAt === null)).toBe(true)
  })

  it('freezes lessons under a known section or module as already completed', async () => {
    const { repos, path } = world()
    const draft = buildDraft({ known_node_ids: ['S01M1'] })
    const version = repos.seedVersion(path.id, { spec: asJson(draft) })

    const result = await freezePath({ repos, clock }, { pathVersionId: version.id })

    const knownModuleLessons = result.tree.sections[0]?.modules[0]?.lessons ?? []
    const otherModuleLessons = result.tree.sections[1]?.modules[0]?.lessons ?? []
    expect(
      knownModuleLessons.every((l) => l.completedAt?.getTime() === clock.now().getTime()),
    ).toBe(true)
    expect(otherModuleLessons.every((l) => l.completedAt === null)).toBe(true)
  })

  it('rejects freezing a version twice', async () => {
    const { repos, path } = world()
    const version = repos.seedVersion(path.id, { spec: asJson(buildDraft()) })
    await freezePath({ repos, clock }, { pathVersionId: version.id })
    await expect(freezePath({ repos, clock }, { pathVersionId: version.id })).rejects.toMatchObject(
      { code: 'already_frozen' },
    )
  })

  it('rejects an unknown version id', async () => {
    const { repos } = world()
    await expect(
      freezePath({ repos, clock }, { pathVersionId: 'does-not-exist' }),
    ).rejects.toMatchObject({ code: 'version_not_found' })
  })
})
