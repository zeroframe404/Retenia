import { describe, expect, it } from 'vitest'
import { PAYLOAD_SCHEMAS } from './index'

/** The key payload fields of the 22 families table (`docs/spec/03-activities.md` §7). */

const ok = (family: keyof typeof PAYLOAD_SCHEMAS, payload: unknown) =>
  PAYLOAD_SCHEMAS[family].safeParse(payload).success

describe('choice payload', () => {
  const set = {
    multiple: false,
    options: [
      { id: 'a', text: 'A', correct: true },
      { id: 'b', text: 'B', correct: false },
    ],
  }
  it('needs at least one set with at least two options', () => {
    expect(ok('choice', { family: 'choice', sets: [set] })).toBe(true)
    expect(ok('choice', { family: 'choice', sets: [] })).toBe(false)
    expect(ok('choice', { family: 'choice', sets: [{ ...set, options: [set.options[0]] }] })).toBe(
      false,
    )
  })
  it('validates layout, select range and confidence flag', () => {
    expect(
      ok('choice', { family: 'choice', sets: [set], layout: 'grid', askConfidence: true }),
    ).toBe(true)
    expect(ok('choice', { family: 'choice', sets: [set], layout: 'carousel' })).toBe(false)
    expect(ok('choice', { family: 'choice', sets: [{ ...set, minSelect: -1 }] })).toBe(false)
    expect(ok('choice', { family: 'choice', sets: [{ ...set, maxSelect: 0 }] })).toBe(false)
  })
})

describe('text_input payload', () => {
  it('needs an input kind and at least one answer', () => {
    expect(
      ok('text_input', { family: 'text_input', inputKind: 'text', answers: [{ value: 'x' }] }),
    ).toBe(true)
    expect(ok('text_input', { family: 'text_input', inputKind: 'text', answers: [] })).toBe(false)
    expect(
      ok('text_input', { family: 'text_input', inputKind: 'voice', answers: [{ value: 'x' }] }),
    ).toBe(false)
    expect(
      ok('text_input', { family: 'text_input', inputKind: 'text', answers: [{ value: '' }] }),
    ).toBe(false)
  })
  it('accepts numeric expectations and regex cases', () => {
    expect(
      ok('text_input', {
        family: 'text_input',
        inputKind: 'number',
        answers: [{ value: '3.5' }],
        numeric: { value: 3.5, tol: { abs: 0.1 }, unit: 'km' },
      }),
    ).toBe(true)
    expect(
      ok('text_input', {
        family: 'text_input',
        inputKind: 'regex',
        answers: [{ value: '^a+$', isRegex: true }],
        regexCases: [{ input: 'aaa', shouldMatch: true }],
      }),
    ).toBe(true)
    expect(
      ok('text_input', {
        family: 'text_input',
        inputKind: 'number',
        answers: [{ value: '1' }],
        numeric: { value: 1, tol: { rel: -1 } },
      }),
    ).toBe(false)
  })
})

describe('cloze payload', () => {
  const gap = { kind: 'gap', id: 'g1', answers: ['x'] }
  it('is a mode plus a non-empty list of text and gap segments', () => {
    expect(
      ok('cloze', {
        family: 'cloze',
        mode: 'typed',
        segments: [{ kind: 'text', text: 'a ' }, gap],
      }),
    ).toBe(true)
    expect(ok('cloze', { family: 'cloze', mode: 'typed', segments: [] })).toBe(false)
    expect(ok('cloze', { family: 'cloze', mode: 'sung', segments: [gap] })).toBe(false)
    expect(
      ok('cloze', {
        family: 'cloze',
        mode: 'typed',
        segments: [{ kind: 'gap', id: 'g1', answers: [] }],
      }),
    ).toBe(false)
    expect(ok('cloze', { family: 'cloze', mode: 'typed', segments: [{ kind: 'blank' }] })).toBe(
      false,
    )
  })
  it('accepts options, prefixes, bank distractors and layout', () => {
    expect(
      ok('cloze', {
        family: 'cloze',
        mode: 'wordbank',
        layout: 'code',
        segments: [{ ...gap, options: ['x', 'y'], visiblePrefix: '' }],
        bankDistractors: ['z'],
        singleUseDraggables: true,
      }),
    ).toBe(true)
  })
})

describe('long_text payload', () => {
  it('accepts every optional field and validates the rubric levels', () => {
    expect(ok('long_text', { family: 'long_text' })).toBe(true)
    expect(
      ok('long_text', {
        family: 'long_text',
        minWords: 50,
        maxWords: 200,
        sections: [{ id: 's1', title: 'Intro', hint: 'Empezá por…' }],
        modelAnswer: '…',
        keyPoints: [{ id: 'k1', text: 'x', weight: 2, aliases: ['y'] }],
        rubric: [
          {
            id: 'r1',
            criterion: 'Claridad',
            levels: [
              { score: 0, description: 'Confuso' },
              { score: 1, description: 'Claro' },
            ],
          },
        ],
      }),
    ).toBe(true)
    expect(ok('long_text', { family: 'long_text', minWords: 0 })).toBe(false)
    expect(
      ok('long_text', { family: 'long_text', keyPoints: [{ id: 'k1', text: 'x', weight: 0 }] }),
    ).toBe(false)
    expect(
      ok('long_text', {
        family: 'long_text',
        rubric: [{ id: 'r1', criterion: 'c', levels: [{ score: 1, description: 'only one' }] }],
      }),
    ).toBe(false)
    expect(
      ok('long_text', {
        family: 'long_text',
        rubric: [
          {
            id: 'r1',
            criterion: 'c',
            levels: [
              { score: 2, description: 'a' },
              { score: 0, description: 'b' },
            ],
          },
        ],
      }),
    ).toBe(false)
  })
})

describe('pairs payload', () => {
  const pairs = [
    { id: 'p1', left: 'a', right: 'b' },
    { id: 'p2', left: 'c', right: 'd' },
  ]
  it('needs a presentation and at least two pairs', () => {
    expect(ok('pairs', { family: 'pairs', presentation: 'drag', pairs })).toBe(true)
    expect(ok('pairs', { family: 'pairs', presentation: 'drag', pairs: [pairs[0]] })).toBe(false)
    expect(ok('pairs', { family: 'pairs', presentation: 'swipe', pairs })).toBe(false)
    expect(
      ok('pairs', {
        family: 'pairs',
        presentation: 'tap-timed',
        pairs,
        timeLimitSec: 30,
        rightDistractors: [{ id: 'd', text: 'e' }],
      }),
    ).toBe(true)
    expect(ok('pairs', { family: 'pairs', presentation: 'drag', pairs, timeLimitSec: 0 })).toBe(
      false,
    )
  })
})

describe('ordering payload', () => {
  const items = [
    { id: 'a', text: 'A' },
    { id: 'b', text: 'B' },
  ]
  it('needs items, a correct order and a scoring', () => {
    expect(
      ok('ordering', { family: 'ordering', items, correctOrder: ['a', 'b'], scoring: 'exact' }),
    ).toBe(true)
    expect(
      ok('ordering', { family: 'ordering', items, correctOrder: ['a'], scoring: 'exact' }),
    ).toBe(false)
    expect(
      ok('ordering', { family: 'ordering', items, correctOrder: ['a', 'b'], scoring: 'spearman' }),
    ).toBe(false)
    expect(
      ok('ordering', {
        family: 'ordering',
        items: [items[0]],
        correctOrder: ['a', 'b'],
        scoring: 'exact',
      }),
    ).toBe(false)
  })
  it('accepts alternatives, distractors, axis and indentation', () => {
    expect(
      ok('ordering', {
        family: 'ordering',
        items: [
          { ...items[0], indent: 0, date: '1810', media: 'm1' },
          { ...items[1], indent: 1 },
        ],
        correctOrder: ['a', 'b'],
        alternativeOrders: [['b', 'a']],
        distractors: [{ id: 'x', text: 'X' }],
        scoring: 'kendall',
        axis: 'timeline',
        checkIndentation: true,
      }),
    ).toBe(true)
    expect(
      ok('ordering', {
        family: 'ordering',
        items,
        correctOrder: ['a', 'b'],
        scoring: 'exact',
        alternativeOrders: [['a']],
      }),
    ).toBe(false)
  })
})

describe('categorize payload', () => {
  it('needs two categories and two items with category ids', () => {
    const categories = [
      { id: 'c1', label: 'Uno' },
      { id: 'c2', label: 'Dos' },
    ]
    const items = [
      { id: 'i1', text: 'x', categoryIds: ['c1'] },
      { id: 'i2', text: 'y', categoryIds: ['c2'] },
    ]
    expect(ok('categorize', { family: 'categorize', categories, items })).toBe(true)
    expect(ok('categorize', { family: 'categorize', categories: [categories[0]], items })).toBe(
      false,
    )
    expect(ok('categorize', { family: 'categorize', categories, items: [items[0]] })).toBe(false)
    expect(
      ok('categorize', {
        family: 'categorize',
        categories,
        items: [{ id: 'i1', text: 'x', categoryIds: [] }, items[1]],
      }),
    ).toBe(false)
  })
})

describe('text_mark payload', () => {
  it('needs at least two tokens and one correct id', () => {
    const tokens = [
      { id: 't1', text: 'a' },
      { id: 't2', text: 'b' },
    ]
    expect(ok('text_mark', { family: 'text_mark', tokens, correctIds: ['t1'] })).toBe(true)
    expect(ok('text_mark', { family: 'text_mark', tokens, correctIds: [] })).toBe(false)
    expect(ok('text_mark', { family: 'text_mark', tokens: [tokens[0]], correctIds: ['t1'] })).toBe(
      false,
    )
    expect(
      ok('text_mark', {
        family: 'text_mark',
        tokens: [{ id: 't1', text: '' }, tokens[1]],
        correctIds: ['t1'],
      }),
    ).toBe(false)
  })
})

describe('cards payload', () => {
  it('needs at least one card with both sides', () => {
    expect(
      ok('cards', { family: 'cards', cards: [{ id: 'c1', front: 'a', back: 'b', media: ['m1'] }] }),
    ).toBe(true)
    expect(ok('cards', { family: 'cards', cards: [] })).toBe(false)
    expect(ok('cards', { family: 'cards', cards: [{ id: 'c1', front: 'a', back: '' }] })).toBe(
      false,
    )
  })
})

describe('disclosure payload', () => {
  it('needs at least one item and a known presentation', () => {
    const items = [{ id: 'n1', title: 'T', body: 'B' }]
    expect(ok('disclosure', { family: 'disclosure', items })).toBe(true)
    expect(ok('disclosure', { family: 'disclosure', items, presentation: 'tabs' })).toBe(true)
    expect(ok('disclosure', { family: 'disclosure', items, presentation: 'modal' })).toBe(false)
    expect(ok('disclosure', { family: 'disclosure', items: [] })).toBe(false)
  })
})

describe('placeholder payloads', () => {
  it('accept any object carrying their own family literal', () => {
    expect(ok('speech', { family: 'speech', targetText: 'Hello', thresholds: { good: 0.8 } })).toBe(
      true,
    )
    expect(ok('speech', { family: 'dialogue' })).toBe(false)
    expect(ok('speech', 'nope')).toBe(false)
    expect(ok('simulation', { family: 'simulation' })).toBe(true)
  })
})
