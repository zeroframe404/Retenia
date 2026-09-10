import { describe, expect, it } from 'vitest'
import { buildDraft, lesson, module, section } from '../testing/edit-fixtures'
import { applyEdit } from './apply'
import { PathEditError } from './types'

/**
 * Every `PathEditOp` through the one dispatcher `pathgen.editDraft` calls
 * (`docs/spec/04-path-generation.md` §13 step 3) — the happy path and the one error each op
 * can raise. Op-specific structural edge cases (prerequisite-break detection, split/merge
 * redistribution) live in their own test files.
 */

describe('applyEdit()', () => {
  it('renames a section, a module and a lesson', () => {
    const draft = buildDraft()
    const renamedSection = applyEdit(draft, {
      kind: 'rename',
      nodeId: 'S01',
      title: '  Nueva sección  ',
    })
    expect(renamedSection.draft.sections[0]?.title).toBe('Nueva sección')

    const renamedModule = applyEdit(draft, {
      kind: 'rename',
      nodeId: 'S01M1',
      title: 'Nuevo módulo',
    })
    expect(renamedModule.draft.sections[0]?.modules[0]?.title).toBe('Nuevo módulo')

    const renamedLesson = applyEdit(draft, {
      kind: 'rename',
      nodeId: 'S01M1L1',
      title: 'Nueva lección',
    })
    expect(renamedLesson.draft.sections[0]?.modules[0]?.lessons[0]?.title).toBe('Nueva lección')
  })

  it('rejects an empty title', () => {
    const draft = buildDraft()
    expect(() => applyEdit(draft, { kind: 'rename', nodeId: 'S01', title: '   ' })).toThrow(
      PathEditError,
    )
  })

  it('reorders a module within its section and reports no prerequisite break', () => {
    const draft = buildDraft({
      sections: [section('S01', { modules: [module('S01M1'), module('S01M2')] })],
    })
    const result = applyEdit(draft, { kind: 'reorder', nodeId: 'S01M2', toIndex: 0 })
    expect(result.draft.sections[0]?.modules.map((m) => m.id)).toEqual(['S01M2', 'S01M1'])
    expect(result.breaksPrerequisite).toBe(false)
  })

  it('excludes a lesson and recomputes stats', () => {
    const draft = buildDraft()
    const result = applyEdit(draft, { kind: 'exclude', nodeId: 'S01M1L2' })
    expect(result.draft.sections[0]?.modules[0]?.lessons).toHaveLength(1)
    expect(result.draft.stats.lessons).toBe(3)
  })

  it('marks and unmarks a module as known, but rejects a lesson id', () => {
    const draft = buildDraft()
    const marked = applyEdit(draft, { kind: 'markKnown', nodeId: 'S01M1' })
    expect(marked.draft.known_node_ids).toEqual(['S01M1'])
    const unmarked = applyEdit(marked.draft, { kind: 'unmarkKnown', nodeId: 'S01M1' })
    expect(unmarked.draft.known_node_ids).toEqual([])
    expect(() => applyEdit(draft, { kind: 'markKnown', nodeId: 'S01M1L1' })).toThrow(PathEditError)
  })

  it('merges two lessons of the same module into one', () => {
    const draft = buildDraft()
    const result = applyEdit(draft, {
      kind: 'mergeLessons',
      lessonIds: ['S01M1L1', 'S01M1L2'],
    })
    const lessons = result.draft.sections[0]?.modules[0]?.lessons
    expect(lessons).toHaveLength(1)
    expect(lessons?.[0]?.concept_ids).toEqual([
      'c_S01M1L1_1',
      'c_S01M1L1_2',
      'c_S01M1L2_1',
      'c_S01M1L2_2',
    ])
    expect(lessons?.[0]?.origin).toBe('merged')
  })

  it('splits a lesson into siblings with origin "split"', () => {
    const draft = buildDraft()
    const result = applyEdit(draft, { kind: 'splitLesson', lessonId: 'S01M1L1', parts: 2 })
    const lessons = result.draft.sections[0]?.modules[0]?.lessons
    expect(lessons?.map((l) => l.id)).toEqual(['S01M1L1a', 'S01M1L1b', 'S01M1L2'])
    expect(lessons?.every((l) => l.id.startsWith('S01M1L2') || l.origin === 'split')).toBe(true)
  })

  it('rejects splitting a lesson with fewer concepts than parts', () => {
    const draft = buildDraft({
      sections: [
        section('S01', {
          modules: [
            module('S01M1', { lessons: [lesson('S01M1L1', { concept_ids: ['only-one'] })] }),
          ],
        }),
      ],
    })
    expect(() => applyEdit(draft, { kind: 'splitLesson', lessonId: 'S01M1L1', parts: 2 })).toThrow(
      PathEditError,
    )
  })

  it('deepens a lesson and projects the extra expansion cost', () => {
    const draft = buildDraft()
    const result = applyEdit(
      draft,
      { kind: 'deepenLesson', lessonId: 'S01M1L1', parts: 2 },
      { perLessonUsd: 0.05 },
    )
    expect(result.projectedCostDeltaUsd).toBeCloseTo(0.05)
  })

  it('sets the primary source, rejecting an unknown id', () => {
    const draft = buildDraft({
      sources: [
        { source_id: 'src-1', title: 'Fuente 1', primary: true },
        { source_id: 'src-2', title: 'Fuente 2', primary: false },
      ],
    })
    const result = applyEdit(draft, { kind: 'setPrimarySource', sourceId: 'src-2' })
    expect(result.draft.sources).toEqual([
      { source_id: 'src-1', title: 'Fuente 1', primary: false },
      { source_id: 'src-2', title: 'Fuente 2', primary: true },
    ])
    expect(() => applyEdit(draft, { kind: 'setPrimarySource', sourceId: 'nope' })).toThrow(
      PathEditError,
    )
  })

  it('replaces the whole draft (undo/redo) and still validates the result', () => {
    const draft = buildDraft()
    const edited = applyEdit(draft, { kind: 'rename', nodeId: 'S01', title: 'Editada' }).draft
    const restored = applyEdit(edited, { kind: 'replace', draft })
    expect(restored.draft).toEqual(draft)
  })

  it('throws node_not_found for an id that does not exist', () => {
    const draft = buildDraft()
    expect(() => applyEdit(draft, { kind: 'rename', nodeId: 'nope', title: 'x' })).toThrow(
      PathEditError,
    )
  })
})
