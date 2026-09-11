import { describe, expect, it } from 'vitest'
import { MIGRATED_TAG, needsFlashcards } from './migrate'

/**
 * Stage 7's P5 skip rule once a regeneration has carried cards over (sub-phase 8.6): a lesson
 * owning only migrated cards gets P5 exactly for the concepts those cards do not cover.
 */

const item = (topicId: string | null, tags: string[] = [], conceptIds: string[] = []) => ({
  topicId,
  fields: { concept_ids: conceptIds },
  tags,
})

describe('needsFlashcards', () => {
  it('owes P5 to a lesson with no items', () => {
    expect(needsFlashcards([], ['c1'])).toBe(true)
  })

  it('never re-writes a lesson that has cards of its own', () => {
    expect(needsFlashcards([item('c1')], ['c1', 'c2'])).toBe(false)
    expect(needsFlashcards([item('c1', [MIGRATED_TAG]), item('c3')], ['c1', 'c2'])).toBe(false)
  })

  it('skips a lesson whose migrated cards cover every concept it teaches', () => {
    expect(
      needsFlashcards([item('c1', [MIGRATED_TAG]), item('c2', [MIGRATED_TAG])], ['c1', 'c2']),
    ).toBe(false)
  })

  it('owes P5 to a lesson that gained a concept its migrated cards do not cover', () => {
    expect(needsFlashcards([item('c1', [MIGRATED_TAG])], ['c1', 'c2'])).toBe(true)
  })

  it('reads the concept from fields.concept_ids when the item has no topic', () => {
    expect(needsFlashcards([item(null, [MIGRATED_TAG], ['c1'])], ['c1'])).toBe(false)
  })

  it('treats a missing tags column as cards of the lesson’s own', () => {
    expect(
      needsFlashcards([{ topicId: 'c1', fields: {}, tags: undefined as never }], ['c1', 'c2']),
    ).toBe(false)
  })
})
