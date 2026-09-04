import {
  sampleCards,
  sampleCategorize,
  sampleDisclosure,
  samplePairs,
  sampleTextMark,
} from '@retenia/activity-schema/testing'
import { describe, expect, it } from 'vitest'
import { gradeCards } from './cards'
import { gradeCategorize } from './categorize'
import { gradeDisclosure } from './disclosure'
import { gradePairs } from './pairs'
import { gradeTextMark } from './text-mark'

const META = { timeMs: 3000, attempts: 1, hintsUsed: 0 }

describe('gradePairs()', () => {
  it('reports each pair and the fraction matched', () => {
    const graded = gradePairs(
      samplePairs(),
      {
        matches: [
          { left: 'p1', right: 'p1' },
          { left: 'p2', right: 'd1' },
        ],
      },
      META,
    )
    expect(graded).toMatchObject({
      score: 1 / 3,
      correct: false,
      feedback: '1 of 3 pairs matched.',
    })
    expect(graded.perItem).toEqual([
      { id: 'p1', correct: true, expected: 'p1', got: 'p1' },
      { id: 'p2', correct: false, expected: 'p2', got: 'd1' },
      { id: 'p3', correct: false, expected: 'p3', got: '' },
    ])
  })
})

describe('gradeCategorize()', () => {
  it('uses the Jaccard overlap per item', () => {
    const graded = gradeCategorize(
      sampleCategorize(),
      { placements: { i1: ['c1', 'c2'], i2: ['c2'], i3: [] } },
      META,
    )
    expect(graded.score).toBeCloseTo((0.5 + 1 + 0) / 3, 10)
    expect(graded.perItem).toEqual([
      { id: 'i1', correct: false, expected: 'c1', got: 'c1,c2' },
      { id: 'i2', correct: true, expected: 'c2', got: 'c2' },
      { id: 'i3', correct: false, expected: 'c1', got: '' },
    ])
    expect(graded.feedback).toBe('1 of 3 items in the right group.')
  })
})

describe('gradeTextMark()', () => {
  it('scores F1 over marked tokens and lists targets and extras', () => {
    const graded = gradeTextMark(sampleTextMark(), { markedIds: ['t3', 't2', 't2', 'zz'] }, META)
    expect(graded.score).toBe(0.5)
    expect(graded.feedback).toBe('Marked 1 of 2 target words; 1 extra.')
    expect(graded.perItem).toEqual([
      { id: 't2', correct: false },
      { id: 't3', correct: true },
      { id: 't5', correct: false },
    ])
  })
})

describe('gradeCards()', () => {
  it('mirrors the pressed button', () => {
    expect(gradeCards(sampleCards(), { rating: 1 }, META)).toMatchObject({
      score: 0,
      correct: false,
      rating: 1,
      feedback: '',
    })
    expect(gradeCards(sampleCards(), { rating: 4 }, META)).toMatchObject({
      score: 1,
      correct: true,
      rating: 4,
    })
    expect(gradeCards(sampleCards(), { rating: 2 }, META).score).toBeCloseTo(1 / 3, 10)
  })
})

describe('gradeDisclosure()', () => {
  it('measures completeness and never rates', () => {
    const graded = gradeDisclosure(sampleDisclosure(), { openedIds: ['n2', 'n2', 'zz'] }, META)
    expect(graded).toMatchObject({
      score: 0.5,
      correct: false,
      rating: null,
      feedback: 'Opened 1 of 2 sections.',
    })
    expect(gradeDisclosure(sampleDisclosure(), { openedIds: ['n1', 'n2'] }, META).correct).toBe(
      true,
    )
  })
})
