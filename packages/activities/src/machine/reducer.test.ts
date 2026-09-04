import type { GradeResult } from '@retenia/activity-schema'
import { describe, expect, it } from 'vitest'
import {
  canHint,
  canRetry,
  canSubmit,
  createActivityReducer,
  initialActivityState,
  isLocked,
} from './reducer'
import {
  ACTIVITY_STATUSES,
  type ActivityAction,
  type ActivityMachineConfig,
  type ActivityMachineState,
  type ActivityStatus,
  allowsHints,
  defersFeedback,
} from './types'

const CONFIG: ActivityMachineConfig = { mode: 'study', maxAttempts: 2, hintCount: 2 }

function grade(overrides: Partial<GradeResult> = {}): GradeResult {
  return {
    score: 1,
    correct: true,
    feedback: 'ok',
    rating: 3,
    meta: { timeMs: 1000, attempts: 1, hintsUsed: 0 },
    ...overrides,
  }
}

function run(
  actions: readonly ActivityAction[],
  config: ActivityMachineConfig = CONFIG,
): ActivityMachineState {
  const reducer = createActivityReducer(config)
  return actions.reduce(reducer, initialActivityState())
}

const PRESENT: ActivityAction = { type: 'PRESENT', at: 1_000 }

/** Every action the machine accepts, for the exhaustive sweeps below. */
const EVERY_ACTION: readonly ActivityAction[] = [
  PRESENT,
  { type: 'RESPOND', response: { value: 'a' } },
  { type: 'SEED', response: { value: 'seeded' } },
  { type: 'REQUEST_HINT' },
  { type: 'DISMISS_HINT' },
  { type: 'SUBMIT' },
  { type: 'GRADE_FAILED', message: 'boom' },
  { type: 'RETRY' },
  { type: 'COMPLETE' },
  { type: 'SKIP' },
  { type: 'TICK', at: 2_000 },
]

/** The shortest action sequence that parks the machine in each status. */
const PATHS: Record<ActivityStatus, readonly ActivityAction[]> = {
  idle: [],
  presenting: [PRESENT],
  answering: [PRESENT, { type: 'RESPOND', response: { value: 'a' } }],
  hinting: [PRESENT, { type: 'RESPOND', response: { value: 'a' } }, { type: 'REQUEST_HINT' }],
  checking: [PRESENT, { type: 'RESPOND', response: { value: 'a' } }, { type: 'SUBMIT' }],
  feedback: [
    PRESENT,
    { type: 'RESPOND', response: { value: 'a' } },
    { type: 'SUBMIT' },
    { type: 'GRADED', result: grade({ correct: false, score: 0 }) },
  ],
  completed: [PRESENT, { type: 'SKIP' }],
}

describe('activity state machine', () => {
  it('starts idle with nothing answered', () => {
    const state = initialActivityState()
    expect(state).toMatchObject({ status: 'idle', response: null, result: null, attempts: 0 })
    expect(isLocked(state)).toBe(true)
  })

  it('reaches every status through its documented path', () => {
    for (const status of ACTIVITY_STATUSES) {
      expect(run(PATHS[status]).status).toBe(status)
    }
  })

  describe('idle', () => {
    it('PRESENT starts the clock', () => {
      expect(run([PRESENT])).toMatchObject({ status: 'presenting', startedAt: 1_000 })
    })

    it('ignores every other action', () => {
      for (const action of EVERY_ACTION) {
        // PRESENT is the transition; SEED, TICK and SKIP are status-independent and are covered
        // on their own below.
        if (action.type === 'PRESENT' || action.type === 'SEED') continue
        if (action.type === 'TICK' || action.type === 'SKIP') continue
        expect(run([action]).status).toBe('idle')
      }
    })

    it('can be skipped before it is presented — a session may drop it as it loads', () => {
      expect(run([{ type: 'SKIP' }])).toMatchObject({ status: 'completed', outcome: 'skipped' })
    })
  })

  describe('presenting → answering → hinting', () => {
    it('RESPOND records the answer and moves to answering', () => {
      expect(run([PRESENT, { type: 'RESPOND', response: { value: 'a' } }])).toMatchObject({
        status: 'answering',
        response: { value: 'a' },
      })
    })

    it('REQUEST_HINT counts the hint and moves to hinting, from presenting or answering', () => {
      expect(run([PRESENT, { type: 'REQUEST_HINT' }])).toMatchObject({
        status: 'hinting',
        hintsUsed: 1,
      })
      expect(run([...PATHS.hinting, { type: 'REQUEST_HINT' }])).toMatchObject({
        status: 'hinting',
        hintsUsed: 2,
      })
    })

    it('stops offering hints once the activity has run out of them', () => {
      const exhausted = run([...PATHS.hinting, { type: 'REQUEST_HINT' }, { type: 'REQUEST_HINT' }])
      expect(exhausted.hintsUsed).toBe(2)
      expect(canHint(exhausted, CONFIG)).toBe(false)
    })

    it('DISMISS_HINT returns to answering, and does nothing anywhere else', () => {
      expect(run([...PATHS.hinting, { type: 'DISMISS_HINT' }]).status).toBe('answering')
      expect(run([...PATHS.presenting, { type: 'DISMISS_HINT' }]).status).toBe('presenting')
    })

    it('RESPOND while a hint is open returns to answering without losing the hint count', () => {
      const state = run([...PATHS.hinting, { type: 'RESPOND', response: { value: 'b' } }])
      expect(state).toMatchObject({ status: 'answering', hintsUsed: 1, response: { value: 'b' } })
    })

    it('SUBMIT moves to checking from presenting, answering and hinting', () => {
      for (const status of ['presenting', 'answering', 'hinting'] as const) {
        expect(run([...PATHS[status], { type: 'SUBMIT' }]).status).toBe('checking')
      }
    })

    it('a hinting activity is still submittable and still unlocked', () => {
      const state = run(PATHS.hinting)
      expect(canSubmit(state)).toBe(true)
      expect(isLocked(state)).toBe(false)
    })
  })

  describe('checking', () => {
    it('GRADED is the only edge into feedback, and it counts the attempt', () => {
      const result = grade({ correct: false, score: 0.4 })
      const state = run([...PATHS.checking, { type: 'GRADED', result }])
      expect(state).toMatchObject({ status: 'feedback', attempts: 1, result })
    })

    it('GRADE_FAILED returns to answering with the message, keeping the answer', () => {
      const state = run([...PATHS.checking, { type: 'GRADE_FAILED', message: 'boom' }])
      expect(state).toMatchObject({
        status: 'answering',
        error: 'boom',
        response: { value: 'a' },
        attempts: 0,
      })
    })

    it('a later RESPOND clears the error', () => {
      const state = run([
        ...PATHS.checking,
        { type: 'GRADE_FAILED', message: 'boom' },
        { type: 'RESPOND', response: { value: 'c' } },
      ])
      expect(state.error).toBeNull()
    })

    it('is locked: no hint, no submit', () => {
      const state = run(PATHS.checking)
      expect(isLocked(state)).toBe(true)
      expect(canHint(state, CONFIG)).toBe(false)
      expect(run([...PATHS.checking, { type: 'REQUEST_HINT' }]).status).toBe('checking')
    })
  })

  describe('feedback', () => {
    it('RETRY returns to answering, drops the result and keeps the answer and the attempt count', () => {
      const state = run([...PATHS.feedback, { type: 'RETRY' }])
      expect(state).toMatchObject({
        status: 'answering',
        result: null,
        attempts: 1,
        response: { value: 'a' },
      })
    })

    it('refuses RETRY on a correct answer', () => {
      const state = run([...PATHS.checking, { type: 'GRADED', result: grade() }, { type: 'RETRY' }])
      expect(state.status).toBe('feedback')
    })

    it('refuses RETRY once maxAttempts is spent', () => {
      const config: ActivityMachineConfig = { ...CONFIG, maxAttempts: 1 }
      const state = run(PATHS.feedback, config)
      expect(canRetry(state, config)).toBe(false)
      expect(run([...PATHS.feedback, { type: 'RETRY' }], config).status).toBe('feedback')
    })

    it('COMPLETE ends the run as graded', () => {
      expect(run([...PATHS.feedback, { type: 'COMPLETE' }])).toMatchObject({
        status: 'completed',
        outcome: 'graded',
      })
    })
  })

  describe('completed', () => {
    it('SKIP from any live status ends the run as skipped', () => {
      for (const status of [
        'presenting',
        'answering',
        'hinting',
        'checking',
        'feedback',
      ] as const) {
        expect(run([...PATHS[status], { type: 'SKIP' }])).toMatchObject({
          status: 'completed',
          outcome: 'skipped',
        })
      }
    })

    it('keeps the grade of a skipped-after-feedback run', () => {
      expect(run([...PATHS.feedback, { type: 'SKIP' }]).result).not.toBeNull()
    })

    it('is terminal: every action is a no-op that returns the same object', () => {
      const reducer = createActivityReducer(CONFIG)
      const done = run([...PATHS.feedback, { type: 'COMPLETE' }])
      for (const action of [...EVERY_ACTION, { type: 'GRADED', result: grade() } as const]) {
        expect(reducer(done, action)).toBe(done)
      }
    })
  })

  describe('the feedback invariant', () => {
    it('cannot be reached without a GradeResult, from any status, by any other action', () => {
      const reducer = createActivityReducer(CONFIG)
      for (const status of ACTIVITY_STATUSES) {
        const state = run(PATHS[status])
        for (const action of EVERY_ACTION) {
          const next = reducer(state, action)
          if (next.status === 'feedback') expect(next.result).not.toBeNull()
        }
      }
    })

    it('never leaves feedback without a result even after a retry round-trip', () => {
      const state = run([
        ...PATHS.feedback,
        { type: 'RETRY' },
        { type: 'SUBMIT' },
        { type: 'GRADED', result: grade({ score: 0.9 }) },
      ])
      expect(state.status).toBe('feedback')
      expect(state.result).toMatchObject({ score: 0.9 })
      expect(state.attempts).toBe(2)
    })
  })

  describe('SEED', () => {
    it('fills the presented answer without leaving presenting', () => {
      const state = run([PRESENT, { type: 'SEED', response: { order: ['a', 'b'] } }])
      expect(state).toMatchObject({ status: 'presenting', response: { order: ['a', 'b'] } })
    })

    it('is accepted before PRESENT, because a lazy renderer mounts first', () => {
      expect(run([{ type: 'SEED', response: { order: ['a'] } }])).toMatchObject({
        status: 'idle',
        response: { order: ['a'] },
      })
    })

    it('never overwrites an answer the user has given', () => {
      const state = run([
        PRESENT,
        { type: 'RESPOND', response: { value: 'mine' } },
        { type: 'SEED', response: { value: 'seeded' } },
      ])
      expect(state.response).toEqual({ value: 'mine' })
    })
  })

  describe('TICK', () => {
    it('is ignored before the activity is presented', () => {
      const state = initialActivityState()
      expect(createActivityReducer(CONFIG)(state, { type: 'TICK', at: 9_000 })).toBe(state)
    })

    it('tracks elapsed time from PRESENT, and keeps running through feedback', () => {
      expect(run([PRESENT, { type: 'TICK', at: 4_500 }]).elapsedMs).toBe(3_500)
      expect(run([...PATHS.feedback, { type: 'TICK', at: 6_000 }]).elapsedMs).toBe(5_000)
    })

    it('freezes once the run is over', () => {
      const state = run([PRESENT, { type: 'TICK', at: 3_000 }, { type: 'SKIP' }])
      const frozen = createActivityReducer(CONFIG)(state, { type: 'TICK', at: 60_000 })
      expect(frozen.elapsedMs).toBe(2_000)
      expect(frozen).toBe(state)
    })

    it('returns the same object when the elapsed millisecond has not changed', () => {
      const reducer = createActivityReducer(CONFIG)
      const state = run([PRESENT, { type: 'TICK', at: 3_000 }])
      expect(reducer(state, { type: 'TICK', at: 3_000 })).toBe(state)
    })

    it('never reports negative time when the clock steps backwards', () => {
      expect(run([PRESENT, { type: 'TICK', at: 500 }]).elapsedMs).toBe(0)
    })
  })

  describe('test mode', () => {
    const config: ActivityMachineConfig = { mode: 'test', maxAttempts: 3, hintCount: 3 }

    it('offers no hints', () => {
      expect(allowsHints(config)).toBe(false)
      expect(canHint(run(PATHS.answering, config), config)).toBe(false)
      expect(run([...PATHS.answering, { type: 'REQUEST_HINT' }], config)).toMatchObject({
        status: 'answering',
        hintsUsed: 0,
      })
    })

    it('defers feedback: GRADED completes the run and carries the result out', () => {
      expect(defersFeedback(config)).toBe(true)
      const result = grade({ correct: false, score: 0.2 })
      const state = run([...PATHS.checking, { type: 'GRADED', result }], config)
      expect(state).toMatchObject({ status: 'completed', outcome: 'graded', attempts: 1, result })
    })

    it('locks the UI after grading, whatever maxAttempts says', () => {
      const state = run([...PATHS.checking, { type: 'GRADED', result: grade() }], config)
      expect(isLocked(state)).toBe(true)
      expect(canRetry(state, config)).toBe(false)
    })
  })
})
