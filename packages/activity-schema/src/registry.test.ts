import { ACTIVITY_FAMILIES, RATING_RULES } from '@retenia/core'
import { describe, expect, it } from 'vitest'
import {
  ACTIVITY_TYPE_IDS,
  ACTIVITY_TYPE_LIST,
  ACTIVITY_TYPES,
  allowedEligibility,
  allowedGradingMethods,
  allowedRatingStrategies,
  familyOf,
  isActivityType,
  isMvpFamily,
  MVP_FAMILIES,
  MVP_TYPES,
  PLACEHOLDER_FAMILIES,
  typesOfFamily,
} from './registry'

/** The master table of `docs/spec/03-activities.md` §4 and the MVP cut of §6. */
describe('ACTIVITY_TYPES', () => {
  it('has the 98 rows of §4, in table order, with unique snake_case ids', () => {
    expect(ACTIVITY_TYPE_LIST).toHaveLength(98)
    expect(Object.keys(ACTIVITY_TYPES)).toHaveLength(98)
    expect(new Set(ACTIVITY_TYPE_IDS).size).toBe(98)
    for (const meta of ACTIVITY_TYPE_LIST) expect(meta.type).toMatch(/^[a-z][a-z0-9_]*$/)
    // Spot checks against the row numbers of §4.
    expect(ACTIVITY_TYPE_LIST[0]?.type).toBe('flashcard_basic')
    expect(ACTIVITY_TYPE_LIST[14]?.type).toBe('mcq_single')
    expect(ACTIVITY_TYPE_LIST[29]?.type).toBe('ordering_sequence')
    expect(ACTIVITY_TYPE_LIST[94]?.type).toBe('disclosure_block')
    expect(ACTIVITY_TYPE_LIST[97]?.type).toBe('play_notes_rhythm')
  })

  it('names the 21 MVP types of §6 across 10 families, and 13 placeholder families', () => {
    expect(MVP_TYPES).toHaveLength(21)
    expect(MVP_TYPES).toEqual(
      expect.arrayContaining([
        'mcq_single',
        'mcq_multi',
        'true_false',
        'statement_set',
        'complete_the_chat',
        'cloze_typed',
        'cloze_dropdown',
        'cloze_wordbank',
        'short_answer',
        'numeric_answer',
        'flashcard_basic',
        'flashcard_reverse',
        'dialog_cards',
        'free_recall',
        'essay_rubric',
        'matching_pairs',
        'ordering_sequence',
        'sentence_builder',
        'categorize',
        'mark_the_words',
        'disclosure_block',
      ]),
    )
    expect(MVP_FAMILIES).toEqual([
      'choice',
      'text_input',
      'cloze',
      'long_text',
      'pairs',
      'ordering',
      'categorize',
      'text_mark',
      'cards',
      'disclosure',
    ])
    expect(PLACEHOLDER_FAMILIES).toHaveLength(13)
    expect(MVP_FAMILIES.length + PLACEHOLDER_FAMILIES.length).toBe(ACTIVITY_FAMILIES.length)
    expect(isMvpFamily('choice')).toBe(true)
    expect(isMvpFamily('speech')).toBe(false)
  })

  it('counts the phases of §6: 21 mvp, 33 phase 2, 18 phase 3, 26 unscheduled', () => {
    const count = (phase: string) => ACTIVITY_TYPE_LIST.filter((m) => m.phase === phase).length
    expect(count('mvp')).toBe(21)
    expect(count('phase2')).toBe(33)
    expect(count('phase3')).toBe(18)
    expect(count('later')).toBe(26)
  })

  it('marks 89 types review-eligible and exactly the 9 `N` rows as `none`', () => {
    const eligible = ACTIVITY_TYPE_LIST.filter((m) => m.reviewEligible)
    expect(eligible).toHaveLength(89)
    const none = ACTIVITY_TYPE_LIST.filter((m) => m.ratingStrategy === 'none').map((m) => m.type)
    expect(none).toEqual([
      'image_hotspots_explore',
      'image_juxtaposition',
      'notes_reflection',
      'typing_drill',
      'word_search',
      'memory_game',
      'virtual_tour_360',
      'disclosure_block',
      'likert_poll',
    ])
    for (const meta of ACTIVITY_TYPE_LIST) {
      expect(meta.reviewEligible).toBe(meta.ratingStrategy !== 'none')
      expect(RATING_RULES).toContain(meta.ratingStrategy)
    }
  })

  it('uses every family of core, and only those (parity with the database CHECK)', () => {
    const used = new Set(ACTIVITY_TYPE_LIST.map((m) => m.family))
    expect([...used].sort()).toEqual([...ACTIVITY_FAMILIES].sort())
    expect(typesOfFamily('choice')).toHaveLength(17)
    expect(typesOfFamily('categorize')).toEqual(['categorize'])
    expect(typesOfFamily('simulation')).toEqual([
      'manipulative',
      'software_simulation',
      'virtual_tour_360',
      'board_puzzle',
      'play_notes_rhythm',
    ])
  })

  it('maps the §10 rating rows: FUZ → fuzzy, ordering → ordering, matching → matching, numeric/code → objective', () => {
    expect(ACTIVITY_TYPES.cloze_typed.ratingStrategy).toBe('fuzzy')
    expect(ACTIVITY_TYPES.short_answer.ratingStrategy).toBe('fuzzy')
    expect(ACTIVITY_TYPES.ordering_sequence.ratingStrategy).toBe('ordering')
    expect(ACTIVITY_TYPES.matching_pairs.ratingStrategy).toBe('matching')
    expect(ACTIVITY_TYPES.numeric_answer.ratingStrategy).toBe('objective')
    expect(ACTIVITY_TYPES.code_tests.ratingStrategy).toBe('objective')
    expect(ACTIVITY_TYPES.mcq_single.ratingStrategy).toBe('binary')
    expect(ACTIVITY_TYPES.mcq_multi.ratingStrategy).toBe('partial')
    expect(ACTIVITY_TYPES.flashcard_basic.ratingStrategy).toBe('self')
    expect(ACTIVITY_TYPES.essay_rubric.ratingStrategy).toBe('ai')
    expect(ACTIVITY_TYPES.pronunciation_word.ratingStrategy).toBe('speech')
  })

  it('exposes the documented alternates on top of the registry default', () => {
    expect(allowedRatingStrategies('cloze_typed')).toEqual(['fuzzy', 'binary', 'partial'])
    expect(allowedRatingStrategies('mcq_single')).toEqual(['binary'])
    expect(allowedEligibility('structure_strip')).toEqual([true, false])
    expect(allowedEligibility('mcq_single')).toEqual([true])
    expect(allowedGradingMethods('short_answer')).toEqual(['fuzzy', 'ai'])
    expect(allowedGradingMethods('mcq_single')).toEqual(['det'])
  })

  it('answers isActivityType and familyOf', () => {
    expect(isActivityType('mcq_single')).toBe(true)
    expect(isActivityType('mcq')).toBe(false)
    expect(isActivityType('toString')).toBe(false)
    expect(isActivityType(42)).toBe(false)
    expect(familyOf('summary_builder')).toBe('choice')
    expect(familyOf('typing_drill')).toBe('text_input')
    expect(familyOf('terminal_task')).toBe('code')
  })
})
