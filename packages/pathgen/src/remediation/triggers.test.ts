import { describe, expect, it } from 'vitest'
import type { ReopenCard, ReopenLog } from '../diagnostic/verify'
import {
  confidentErrorTrigger,
  memoryTrigger,
  misconceptionTrigger,
  reinforcementTriggers,
  userRequestTrigger,
} from './triggers'
import type { ReinforcementAnswer } from './types'

const NOW = new Date('2026-09-01T12:00:00Z')
const DAY_MS = 86_400_000

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS)
}

function answer(overrides: Partial<ReinforcementAnswer>): ReinforcementAnswer {
  return { conceptIds: ['c1'], correct: false, ...overrides }
}

describe('reinforcementTriggers()', () => {
  it('fires for a concept at 50%', () => {
    const candidates = reinforcementTriggers({
      pathVersionId: 'pv1',
      moduleId: 'm1',
      answers: [
        answer({ conceptIds: ['c1'], correct: true }),
        answer({ conceptIds: ['c1'], correct: false }),
      ],
    })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.conceptId).toBe('c1')
    expect(candidates[0]?.trigger).toBe('reinforcement_low')
  })

  it('does not fire for a concept at exactly 70% (the threshold is exclusive)', () => {
    const answers: ReinforcementAnswer[] = [
      answer({ correct: true }),
      answer({ correct: true }),
      answer({ correct: true }),
      answer({ correct: true }),
      answer({ correct: true }),
      answer({ correct: true }),
      answer({ correct: true }),
      answer({ correct: false }),
      answer({ correct: false }),
      answer({ correct: false }),
    ]
    const candidates = reinforcementTriggers({ pathVersionId: 'pv1', moduleId: 'm1', answers })
    expect(candidates).toHaveLength(0)
  })

  it('does not fire for a concept at 100%', () => {
    const candidates = reinforcementTriggers({
      pathVersionId: 'pv1',
      moduleId: 'm1',
      answers: [answer({ correct: true }), answer({ correct: true })],
    })
    expect(candidates).toHaveLength(0)
  })

  it('sorts several low concepts worst-accuracy first, ties broken by first-seen order', () => {
    const candidates = reinforcementTriggers({
      pathVersionId: 'pv1',
      moduleId: 'm1',
      answers: [
        // c1: 1/2 = 0.5, seen first
        answer({ conceptIds: ['c1'], correct: true }),
        answer({ conceptIds: ['c1'], correct: false }),
        // c2: 0/2 = 0, seen second
        answer({ conceptIds: ['c2'], correct: false }),
        answer({ conceptIds: ['c2'], correct: false }),
        // c3: 0/2 = 0, seen third — ties with c2 on accuracy
        answer({ conceptIds: ['c3'], correct: false }),
        answer({ conceptIds: ['c3'], correct: false }),
      ],
    })
    expect(candidates.map((c) => c.conceptId)).toEqual(['c2', 'c3', 'c1'])
  })

  it('counts an answer naming two concepts for both', () => {
    const candidates = reinforcementTriggers({
      pathVersionId: 'pv1',
      moduleId: 'm1',
      answers: [answer({ conceptIds: ['c1', 'c2'], correct: false })],
    })
    expect(candidates.map((c) => c.conceptId).sort()).toEqual(['c1', 'c2'])
    for (const candidate of candidates) {
      expect(candidate.evidence.answered).toBe(1)
    }
  })

  it('counts a concept listed twice in one answer only once', () => {
    const candidates = reinforcementTriggers({
      pathVersionId: 'pv1',
      moduleId: 'm1',
      answers: [answer({ conceptIds: ['c1', 'c1'], correct: false })],
    })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.evidence.answered).toBe(1)
  })

  it('evidence carries module_id, answered, correct, accuracy and threshold', () => {
    const candidates = reinforcementTriggers({
      pathVersionId: 'pv1',
      moduleId: 'm7',
      answers: [
        answer({ conceptIds: ['c1'], correct: true }),
        answer({ conceptIds: ['c1'], correct: false }),
      ],
    })
    expect(candidates[0]?.evidence).toEqual({
      module_id: 'm7',
      answered: 2,
      correct: 1,
      accuracy: 0.5,
      threshold: 0.7,
    })
  })

  it('errors contains only wrong answers that have a stem, with chosen/correct mapped', () => {
    const candidates = reinforcementTriggers({
      pathVersionId: 'pv1',
      moduleId: 'm1',
      answers: [
        answer({
          conceptIds: ['c1'],
          correct: false,
          stem: 'What is X?',
          chosen: 'a',
          correctAnswer: 'b',
        }),
        answer({ conceptIds: ['c1'], correct: false }), // no stem
        answer({ conceptIds: ['c1'], correct: true, stem: 'ignored because correct' }),
      ],
    })
    expect(candidates[0]?.errors).toEqual([{ stem: 'What is X?', chosen: 'a', correct: 'b' }])
  })

  it("misconceptionId is the most frequent misconception among the concept's wrong answers", () => {
    const candidates = reinforcementTriggers({
      pathVersionId: 'pv1',
      moduleId: 'm1',
      answers: [
        answer({ conceptIds: ['c1'], correct: false, misconceptionId: 'mc1' }),
        answer({ conceptIds: ['c1'], correct: false, misconceptionId: 'mc1' }),
        answer({ conceptIds: ['c1'], correct: false, misconceptionId: 'mc2' }),
      ],
    })
    expect(candidates[0]?.misconceptionId).toBe('mc1')
  })

  it('misconceptionId is null when no wrong answer names one', () => {
    const candidates = reinforcementTriggers({
      pathVersionId: 'pv1',
      moduleId: 'm1',
      answers: [
        answer({ conceptIds: ['c1'], correct: false }),
        answer({ conceptIds: ['c1'], correct: false }),
      ],
    })
    expect(candidates[0]?.misconceptionId).toBeNull()
  })
})

describe('memoryTrigger()', () => {
  it('fires memory_lapses on two Again reviews (state Review) inside 14 days', () => {
    const logs: ReopenLog[] = [
      { rating: 1, state: 2, review: daysAgo(1) },
      { rating: 1, state: 2, review: daysAgo(5) },
    ]
    const candidate = memoryTrigger({
      pathVersionId: 'pv1',
      conceptId: 'c1',
      now: NOW,
      logs,
      cards: [],
    })
    expect(candidate?.trigger).toBe('memory_lapses')
    expect(candidate?.conceptId).toBe('c1')
  })

  it('does not count an Again during learning (state 1) as a lapse', () => {
    const logs: ReopenLog[] = [
      { rating: 1, state: 1, review: daysAgo(1) },
      { rating: 1, state: 1, review: daysAgo(2) },
    ]
    const candidate = memoryTrigger({
      pathVersionId: 'pv1',
      conceptId: 'c1',
      now: NOW,
      logs,
      cards: [],
    })
    expect(candidate).toBeNull()
  })

  it('does not count a lapse older than 14 days', () => {
    const logs: ReopenLog[] = [
      { rating: 1, state: 2, review: new Date(NOW.getTime() - 14 * DAY_MS - 1) },
      { rating: 1, state: 2, review: daysAgo(1) },
    ]
    const candidate = memoryTrigger({
      pathVersionId: 'pv1',
      conceptId: 'c1',
      now: NOW,
      logs,
      cards: [],
    })
    expect(candidate).toBeNull()
  })

  it('fires memory_retention when mean R < 0.7 (cards in state New excluded)', () => {
    const cards: ReopenCard[] = [
      { state: 0, retrievability: 0.01 },
      { state: 2, retrievability: 0.5 },
    ]
    const candidate = memoryTrigger({
      pathVersionId: 'pv1',
      conceptId: 'c1',
      now: NOW,
      logs: [],
      cards,
    })
    expect(candidate?.trigger).toBe('memory_retention')
    expect(candidate?.evidence.mean_r).toBe(0.5)
  })

  it('prefers memory_lapses when both conditions hold', () => {
    const logs: ReopenLog[] = [
      { rating: 1, state: 2, review: daysAgo(1) },
      { rating: 1, state: 2, review: daysAgo(2) },
    ]
    const cards: ReopenCard[] = [{ state: 2, retrievability: 0.3 }]
    const candidate = memoryTrigger({
      pathVersionId: 'pv1',
      conceptId: 'c1',
      now: NOW,
      logs,
      cards,
    })
    expect(candidate?.trigger).toBe('memory_lapses')
  })

  it('returns null when neither condition holds', () => {
    const candidate = memoryTrigger({
      pathVersionId: 'pv1',
      conceptId: 'c1',
      now: NOW,
      logs: [],
      cards: [{ state: 2, retrievability: 0.95 }],
    })
    expect(candidate).toBeNull()
  })
})

describe('confidentErrorTrigger()', () => {
  const base = {
    pathVersionId: 'pv1',
    context: 'diagnostic' as const,
    conceptIds: ['c1', 'c2'],
    misconceptionId: null,
    correct: false,
  }

  it('fires on a wrong answer with confidence "sure", naming the first concept', () => {
    const candidate = confidentErrorTrigger({ ...base, confidence: 'sure' })
    expect(candidate?.trigger).toBe('confident_error')
    expect(candidate?.conceptId).toBe('c1')
    expect(candidate?.evidence.context).toBe('diagnostic')
    expect(candidate?.evidence.concept_ids).toEqual(['c1', 'c2'])
  })

  it.each(['unsure', 'guessed', null] as const)('returns null for confidence %j', (confidence) => {
    expect(confidentErrorTrigger({ ...base, confidence })).toBeNull()
  })

  it('returns null for a correct answer', () => {
    expect(confidentErrorTrigger({ ...base, correct: true, confidence: 'sure' })).toBeNull()
  })

  it('returns null for empty conceptIds', () => {
    expect(confidentErrorTrigger({ ...base, conceptIds: [], confidence: 'sure' })).toBeNull()
  })

  it('passes the error through into errors', () => {
    const error = { stem: 'Q', chosen: 'a', correct: 'b' }
    const candidate = confidentErrorTrigger({ ...base, confidence: 'sure', error })
    expect(candidate?.errors).toEqual([error])
  })

  it('errors is empty when no error is passed', () => {
    const candidate = confidentErrorTrigger({ ...base, confidence: 'sure' })
    expect(candidate?.errors).toEqual([])
  })
})

describe('misconceptionTrigger()', () => {
  const base = {
    pathVersionId: 'pv1',
    conceptId: 'c1',
    misconceptionId: 'mc1',
  }

  it('returns null on the first failure', () => {
    expect(misconceptionTrigger({ ...base, failures: 1 })).toBeNull()
  })

  it('fires repeated_misconception on the second failure', () => {
    const candidate = misconceptionTrigger({ ...base, failures: 2 })
    expect(candidate?.trigger).toBe('repeated_misconception')
    expect(candidate?.misconceptionId).toBe('mc1')
  })
})

describe('userRequestTrigger()', () => {
  it('always returns a user_request candidate with the lesson id set', () => {
    const candidate = userRequestTrigger({
      pathVersionId: 'pv1',
      lessonId: 'L07',
      conceptId: 'c1',
    })
    expect(candidate).toEqual({
      trigger: 'user_request',
      pathVersionId: 'pv1',
      conceptId: 'c1',
      misconceptionId: null,
      lessonId: 'L07',
      evidence: { lesson_id: 'L07' },
      errors: [],
    })
  })
})
