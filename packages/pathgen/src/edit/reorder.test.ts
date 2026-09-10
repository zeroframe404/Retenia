import { describe, expect, it } from 'vitest'
import { buildDraft, lesson, module, section } from '../testing/edit-fixtures'
import { reorderNode } from './reorder'

/**
 * Prerequisite-break detection (`docs/spec/04-path-generation.md` §13 step 2: "warn when it
 * breaks a prerequisite edge"). A break is a lesson whose declared prerequisite now reads at
 * or after the lesson itself, in the new document order.
 */

describe('reorderNode()', () => {
  it('does not flag a reorder that keeps every prerequisite before its dependent', () => {
    const draft = buildDraft() // S01M1L2 depends on S01M1L1, already in that order
    const { breaksPrerequisite } = reorderNode(draft, 'S02', 0)
    expect(breaksPrerequisite).toBe(false)
  })

  it('flags moving a lesson ahead of its own prerequisite', () => {
    const draft = buildDraft({
      sections: [
        section('S01', {
          modules: [
            module('S01M1', {
              lessons: [
                lesson('S01M1L1'),
                lesson('S01M1L2', { prerequisite_lesson_ids: ['S01M1L1'] }),
              ],
            }),
          ],
        }),
      ],
    })
    const { draft: next, breaksPrerequisite } = reorderNode(draft, 'S01M1L2', 0)
    expect(next.sections[0]?.modules[0]?.lessons.map((l) => l.id)).toEqual(['S01M1L2', 'S01M1L1'])
    expect(breaksPrerequisite).toBe(true)
  })

  it('flags moving a whole module past the module its lesson depends on, across modules', () => {
    const draft = buildDraft({
      sections: [
        section('S01', {
          modules: [
            module('M1', { lessons: [lesson('M1L1')] }),
            module('M2', { lessons: [lesson('M2L1', { prerequisite_lesson_ids: ['M1L1'] })] }),
          ],
        }),
      ],
    })
    const { breaksPrerequisite } = reorderNode(draft, 'M2', 0)
    expect(breaksPrerequisite).toBe(true)
  })

  it('clamps toIndex to the array bounds rather than throwing', () => {
    const draft = buildDraft()
    const { draft: next } = reorderNode(draft, 'S01', 999)
    expect(next.sections.map((s) => s.id)).toEqual(['S02', 'S01'])
  })
})
