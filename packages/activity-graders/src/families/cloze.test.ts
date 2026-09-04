import type { Activity } from '@retenia/activity-schema'
import { sampleCloze } from '@retenia/activity-schema/testing'
import { describe, expect, it } from 'vitest'
import { gradeCloze } from './cloze'

const META = { timeMs: 3000, attempts: 1, hintsUsed: 0 }

describe('gradeCloze()', () => {
  it('typed gaps earn their similarity; correct means every gap matched', () => {
    const graded = gradeCloze(sampleCloze(), { gaps: { g1: 'Parris' } }, META)
    expect(graded.score).toBeCloseTo(5 / 6, 10)
    expect(graded).toMatchObject({
      correct: true,
      feedback: 'All 1 gaps correct.',
      meta: { engine: 'fuzzy' },
    })
    expect(gradeCloze(sampleCloze(), { gaps: {} }, META)).toMatchObject({
      score: 0,
      correct: false,
      feedback: '0 of 1 gaps correct.',
    })
  })

  it('honours grading.fuzzy for typed gaps', () => {
    const fuzzy: Activity<'cloze'> = {
      ...sampleCloze(),
      grading: {
        method: 'fuzzy',
        fuzzy: {
          caseSensitive: true,
          ignoreDiacritics: false,
          synonyms: [['París', 'Lutecia']],
          maxRelativeEditDistance: 0.5,
        },
      },
    }
    expect(gradeCloze(fuzzy, { gaps: { g1: 'Lutecia' } }, META).score).toBe(1)
    expect(gradeCloze(fuzzy, { gaps: { g1: 'paris' } }, META).correct).toBe(true)
    expect(gradeCloze(fuzzy, { gaps: { g1: 'paris' } }, META).score).toBeLessThan(1)
  })

  it('dropdown and word-bank gaps are exact: a near miss is 0', () => {
    const dropdown: Activity<'cloze'> = {
      ...sampleCloze(),
      type: 'cloze_dropdown',
      grading: { method: 'det' },
      review: { eligible: true, ratingStrategy: 'partial' },
      payload: { ...sampleCloze().payload, mode: 'dropdown' },
    }
    expect(gradeCloze(dropdown, { gaps: { g1: 'Parris' } }, META)).toMatchObject({
      score: 0,
      correct: false,
    })
    expect(gradeCloze(dropdown, { gaps: { g1: 'paris' } }, META)).toMatchObject({
      score: 1,
      correct: true,
    })
    const wordbank: Activity<'cloze'> = {
      ...dropdown,
      type: 'cloze_wordbank',
      payload: { ...dropdown.payload, mode: 'wordbank' },
      grading: { method: 'det', fuzzy: { maxRelativeEditDistance: 0.9 } },
    }
    expect(gradeCloze(wordbank, { gaps: { g1: 'Parris' } }, META).score).toBe(0)
  })
})
