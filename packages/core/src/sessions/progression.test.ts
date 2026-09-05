import { describe, expect, it } from 'vitest'
import { cardEntryFixture } from '../testing/activity-fixtures'
import {
  ladderForEntry,
  PROGRESSION_STABILITY,
  stageForEntry,
  stageForStability,
  stageLadder,
} from './progression'

describe('stageForStability', () => {
  it.each([
    // §5's bands, closed at the top: `S < 3` recognition, `3 ≤ S ≤ 21` assisted, `S > 21`
    // production. The boundaries are the whole point, so both edges are pinned here.
    [0, 'recognition'],
    [2.999, 'recognition'],
    [PROGRESSION_STABILITY.assisted, 'assisted'],
    [10, 'assisted'],
    [PROGRESSION_STABILITY.production, 'assisted'],
    [21.001, 'production'],
    [60, 'production'],
  ] as const)('reads S = %s as %s', (stability, expected) => {
    expect(stageForStability(stability)).toBe(expected)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    'falls back to recognition for the unusable stability %s',
    (stability) => {
      // "We do not know" must never be read as "known very well".
      expect(stageForStability(stability)).toBe('recognition')
    },
  )
})

describe('stageForEntry', () => {
  it('reads a due card straight from its stability', () => {
    expect(stageForEntry(cardEntryFixture({ stability: 60 }))).toBe('production')
  })

  it('demotes a relearning card one rung', () => {
    // Failed minutes ago: its stability still says 60 days, but free recall is not the
    // honest ask right now.
    expect(stageForEntry(cardEntryFixture({ stability: 60, kind: 'relearning' }))).toBe('assisted')
  })

  it('never demotes a relearning card below recognition', () => {
    expect(stageForEntry(cardEntryFixture({ stability: 10, kind: 'relearning' }))).toBe(
      'recognition',
    )
    expect(stageForEntry(cardEntryFixture({ stability: 0, kind: 'relearning' }))).toBe(
      'recognition',
    )
  })
})

describe('stageLadder', () => {
  it('never lets a production skill fall back to recognition', () => {
    // The acceptance rule of sub-phase 5.6, as a property of the table rather than of the
    // selector: there is no relaxation level at which a high-stability skill is offered
    // multiple choice.
    expect(stageLadder('production')).not.toContain('recognition')
  })

  it.each([
    ['recognition', ['recognition', 'assisted']],
    ['assisted', ['assisted', 'production', 'recognition']],
    ['production', ['production', 'assisted']],
  ] as const)('ladders %s as %s', (ideal, expected) => {
    expect(stageLadder(ideal)).toEqual(expected)
  })

  it('gives theory an empty ladder — lesson-only types are never review material', () => {
    expect(stageLadder('theory')).toEqual([])
  })
})

describe('ladderForEntry', () => {
  it('never lets a 60-day skill reach recognition, even when relearning demoted it', () => {
    // The demotion alone is not enough: it moves the card to `assisted`, whose ladder
    // legitimately includes `recognition` for a skill that really sits in that band. The
    // filter has to read the card's own stability, which is what the rule is about.
    const entry = cardEntryFixture({ stability: 60, kind: 'relearning' })
    expect(stageForEntry(entry)).toBe('assisted')
    expect(ladderForEntry(entry)).not.toContain('recognition')
  })

  it('leaves the ladder alone for a skill genuinely in the assisted band', () => {
    const entry = cardEntryFixture({ stability: 10 })
    expect(ladderForEntry(entry)).toEqual(['assisted', 'production', 'recognition'])
  })

  it('leaves recognition available to a new skill', () => {
    expect(ladderForEntry(cardEntryFixture({ stability: 0 }))).toContain('recognition')
  })
})
