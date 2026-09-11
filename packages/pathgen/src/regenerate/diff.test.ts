import { describe, expect, it } from 'vitest'
import { buildDraft, lesson, module, section } from '../testing/edit-fixtures'
import { diffDrafts, versionDiffSchema } from './diff'

describe('diffDrafts()', () => {
  it('marks every lesson unchanged when nothing moved and echoes the version numbers', () => {
    const draft = buildDraft()
    const result = diffDrafts(draft, buildDraft(), { from: 1, to: 2 })

    expect(versionDiffSchema.parse(result)).toEqual(result)
    expect(result.from_version).toBe(1)
    expect(result.to_version).toBe(2)
    expect(result.lessons).toHaveLength(4)
    expect(result.lessons.every((entry) => entry.change === 'unchanged')).toBe(true)
    expect(result.summary).toEqual({ unchanged: 4, changed: 0, added: 0, removed: 0 })
  })

  it('treats a lesson as unchanged when its id, title and position moved but its concepts did not', () => {
    const previous = buildDraft({
      sections: [
        section('S01', {
          modules: [
            module('S01M1', {
              lessons: [
                lesson('L1', { title: 'Old first', concept_ids: ['c1', 'c2'] }),
                lesson('L2', { title: 'Old second', concept_ids: ['c3'] }),
              ],
            }),
          ],
        }),
      ],
    })
    const next = buildDraft({
      sections: [
        section('S01', {
          modules: [
            module('S01M1', {
              // Swapped order and renamed/re-identified, same concept sets.
              lessons: [
                lesson('L2-new', { title: 'New second', concept_ids: ['c3'] }),
                lesson('L1-new', { title: 'New first', concept_ids: ['c1', 'c2'] }),
              ],
            }),
          ],
        }),
      ],
    })

    const result = diffDrafts(previous, next, { from: 1, to: 2 })

    expect(result.summary).toEqual({ unchanged: 2, changed: 0, added: 0, removed: 0 })
    const byNewId = new Map(result.lessons.map((entry) => [entry.spec_id, entry]))
    expect(byNewId.get('L2-new')).toMatchObject({
      change: 'unchanged',
      previous_spec_id: 'L2',
      previous_title: 'Old second',
    })
    expect(byNewId.get('L1-new')).toMatchObject({
      change: 'unchanged',
      previous_spec_id: 'L1',
      previous_title: 'Old first',
    })
  })

  it('marks a lesson changed when it gained a concept, with the gain in added_concepts', () => {
    const previous = buildDraft({
      sections: [
        section('S01', {
          modules: [
            module('S01M1', {
              lessons: [lesson('L1', { concept_ids: ['c1', 'c2'] })],
            }),
          ],
        }),
      ],
    })
    const next = buildDraft({
      sections: [
        section('S01', {
          modules: [
            module('S01M1', {
              lessons: [lesson('L1', { concept_ids: ['c1', 'c2', 'c3'] })],
            }),
          ],
        }),
      ],
    })

    const result = diffDrafts(previous, next, { from: 1, to: 2 })

    expect(result.lessons).toEqual([
      {
        change: 'changed',
        spec_id: 'L1',
        title: 'Lección L1',
        previous_spec_id: 'L1',
        previous_title: 'Lección L1',
        added_concepts: ['c3'],
        removed_concepts: [],
        kept_concepts: ['c1', 'c2'],
      },
    ])
  })

  it('marks a lesson changed when it lost a concept, with the loss in removed_concepts', () => {
    const previous = buildDraft({
      sections: [
        section('S01', {
          modules: [
            module('S01M1', {
              lessons: [lesson('L1', { concept_ids: ['c1', 'c2'] })],
            }),
          ],
        }),
      ],
    })
    const next = buildDraft({
      sections: [
        section('S01', {
          modules: [
            module('S01M1', {
              lessons: [lesson('L1', { concept_ids: ['c1'] })],
            }),
          ],
        }),
      ],
    })

    const result = diffDrafts(previous, next, { from: 1, to: 2 })

    expect(result.lessons).toEqual([
      {
        change: 'changed',
        spec_id: 'L1',
        title: 'Lección L1',
        previous_spec_id: 'L1',
        previous_title: 'Lección L1',
        added_concepts: [],
        removed_concepts: ['c2'],
        kept_concepts: ['c1'],
      },
    ])
  })

  it('marks an unpaired v2 lesson added and an unpaired v1 lesson removed, appended after the v2 lessons', () => {
    const previous = buildDraft({
      sections: [
        section('S01', {
          modules: [
            module('S01M1', {
              lessons: [
                lesson('L1', { concept_ids: ['c1'] }),
                lesson('LGone', { concept_ids: ['c9'] }),
              ],
            }),
          ],
        }),
      ],
    })
    const next = buildDraft({
      sections: [
        section('S01', {
          modules: [
            module('S01M1', {
              lessons: [
                lesson('L1', { concept_ids: ['c1'] }),
                lesson('LNew', { concept_ids: ['c99'] }),
              ],
            }),
          ],
        }),
      ],
    })

    const result = diffDrafts(previous, next, { from: 1, to: 2 })

    expect(result.lessons.map((entry) => entry.spec_id)).toEqual(['L1', 'LNew', null])
    expect(result.lessons.map((entry) => entry.change)).toEqual(['unchanged', 'added', 'removed'])
    expect(result.lessons[1]).toMatchObject({
      change: 'added',
      spec_id: 'LNew',
      previous_spec_id: null,
      added_concepts: ['c99'],
    })
    expect(result.lessons[2]).toMatchObject({
      change: 'removed',
      spec_id: null,
      previous_spec_id: 'LGone',
      removed_concepts: ['c9'],
    })
    expect(result.summary).toEqual({ unchanged: 1, changed: 0, added: 1, removed: 1 })
  })

  it('pairs one-to-one by best Jaccard: the higher-overlap lesson wins, the loser becomes added', () => {
    // X{c1,c2} vs A{c1,c2,c3} -> shared 2 / union 3 = .667 (best); vs B{c1} -> shared 1 / union 2 = .5
    const previous = buildDraft({
      sections: [
        section('S01', {
          modules: [
            module('S01M1', {
              lessons: [
                lesson('X', { concept_ids: ['c1', 'c2'] }),
                lesson('Y', { concept_ids: ['c3', 'c4'] }),
              ],
            }),
          ],
        }),
      ],
    })
    const next = buildDraft({
      sections: [
        section('S01', {
          modules: [
            module('S01M1', {
              lessons: [
                lesson('A', { concept_ids: ['c1', 'c2', 'c3'] }),
                lesson('B', { concept_ids: ['c1'] }),
              ],
            }),
          ],
        }),
      ],
    })

    const result = diffDrafts(previous, next, { from: 1, to: 2 })
    const byId = new Map(result.lessons.map((entry) => [entry.spec_id, entry]))

    expect(byId.get('A')).toMatchObject({ change: 'changed', previous_spec_id: 'X' })
    // B's only overlap (with X) is already taken and it shares nothing with Y, so it is added.
    expect(byId.get('B')).toMatchObject({ change: 'added', previous_spec_id: null })
    const removed = result.lessons.filter((entry) => entry.change === 'removed')
    expect(removed).toEqual([
      {
        change: 'removed',
        spec_id: null,
        title: null,
        previous_spec_id: 'Y',
        previous_title: 'Lección Y',
        added_concepts: [],
        removed_concepts: ['c3', 'c4'],
        kept_concepts: [],
      },
    ])
  })

  it('pairs the loser of a competition elsewhere when it also overlaps a different v1 lesson', () => {
    // X{c1,c2}, Y{c3,c4}. A{c1,c2,c3} beats B{c1,c4} for X (.667 > .333); B then pairs with Y (.333).
    const previous = buildDraft({
      sections: [
        section('S01', {
          modules: [
            module('S01M1', {
              lessons: [
                lesson('X', { concept_ids: ['c1', 'c2'] }),
                lesson('Y', { concept_ids: ['c3', 'c4'] }),
              ],
            }),
          ],
        }),
      ],
    })
    const next = buildDraft({
      sections: [
        section('S01', {
          modules: [
            module('S01M1', {
              lessons: [
                lesson('A', { concept_ids: ['c1', 'c2', 'c3'] }),
                lesson('B', { concept_ids: ['c1', 'c4'] }),
              ],
            }),
          ],
        }),
      ],
    })

    const result = diffDrafts(previous, next, { from: 1, to: 2 })
    const byId = new Map(result.lessons.map((entry) => [entry.spec_id, entry]))

    expect(byId.get('A')).toMatchObject({ change: 'changed', previous_spec_id: 'X' })
    expect(byId.get('B')).toMatchObject({
      change: 'changed',
      previous_spec_id: 'Y',
      added_concepts: ['c1'],
      removed_concepts: ['c3'],
      kept_concepts: ['c4'],
    })
    expect(result.lessons.some((entry) => entry.change === 'removed')).toBe(false)
  })

  it('tallies path-level concepts.added / removed / kept', () => {
    const previous = buildDraft({
      sections: [
        section('S01', {
          modules: [
            module('S01M1', {
              lessons: [lesson('L1', { concept_ids: ['c1', 'c2'] })],
            }),
          ],
        }),
      ],
    })
    const next = buildDraft({
      sections: [
        section('S01', {
          modules: [
            module('S01M1', {
              lessons: [lesson('L1', { concept_ids: ['c2', 'c3'] })],
            }),
          ],
        }),
      ],
    })

    const result = diffDrafts(previous, next, { from: 3, to: 4 })

    expect(result.concepts).toEqual({ added: ['c3'], removed: ['c1'], kept: 1 })
    expect(result.from_version).toBe(3)
    expect(result.to_version).toBe(4)
  })
})
