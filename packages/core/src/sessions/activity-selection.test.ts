import { describe, expect, it } from 'vitest'
import { DAY_MS } from '../memory/study-day'
import { activityOptionFixture, cardEntryFixture } from '../testing/activity-fixtures'
import type { ActivityOption } from './activity-option'
import { V1_CAPABILITIES } from './activity-option'
import {
  applySelection,
  createActivitySelector,
  EMPTY_ACTIVITY_HISTORY,
  historyFromOutcomes,
  selectActivity,
} from './activity-selection'

const NOW = new Date('2026-06-01T12:00:00.000Z')
const SEED = 'seed-1'

/** One fixed entry, so the per-card seed is identical across calls that must agree. */
const ENTRY = cardEntryFixture({ stability: 60, cardId: '019a0000-0000-7000-8000-0000000000ff' })

function select(
  options: readonly ActivityOption[],
  overrides: Partial<Parameters<typeof selectActivity>[0]> = {},
) {
  return selectActivity({
    entry: ENTRY,
    options,
    history: EMPTY_ACTIVITY_HISTORY,
    seed: SEED,
    now: NOW,
    ...overrides,
  })
}

const recognition = () =>
  activityOptionFixture({
    type: 'mcq_single',
    progression: 'recognition',
    ratingStrategy: 'binary',
  })
const assisted = () =>
  activityOptionFixture({
    type: 'matching_pairs',
    family: 'pairs',
    progression: 'assisted',
    ratingStrategy: 'matching',
  })
const production = () =>
  activityOptionFixture({
    type: 'short_answer',
    family: 'text_input',
    progression: 'production',
    ratingStrategy: 'fuzzy',
  })

describe('progression drives the choice', () => {
  it('never serves recognition to a 60-day skill when a production activity exists', () => {
    // The acceptance criterion of sub-phase 5.6, stated directly.
    const chosen = select([recognition(), production()])
    expect(chosen?.option.progression).toBe('production')
    expect(chosen?.idealStage).toBe('production')
    expect(chosen?.rung).toBe(0)
    expect(chosen?.relaxed).toEqual([])
  })

  it('returns null rather than recognition when only recognition is left', () => {
    // The other half of the rule: the runner then renders the plain flashcard, which is
    // itself production-tier self-rated recall — never *easier* than what was refused.
    expect(select([recognition()])).toBeNull()
  })

  it('serves recognition to a brand-new skill', () => {
    const chosen = select([recognition(), production()], {
      entry: cardEntryFixture({ stability: 0 }),
    })
    expect(chosen?.option.progression).toBe('recognition')
  })

  it('falls to an adjacent stage before giving up', () => {
    const chosen = select([assisted()])
    expect(chosen?.option.progression).toBe('assisted')
    expect(chosen?.rung).toBe(2)
    // The cooldown is given up first: it is this sub-phase's own heuristic, whereas the
    // progression bands are what §5 states normatively.
    expect(chosen?.relaxed).toEqual(['cooldown', 'stage'])
  })
})

describe('the hard filter is never relaxed', () => {
  it('returns null for an empty pool', () => {
    expect(select([])).toBeNull()
  })

  it('drops lesson-only activities', () => {
    expect(select([production(), { ...production(), eligible: false }].slice(1))).toBeNull()
  })

  it('drops types whose rule never feeds the scheduler', () => {
    expect(select([{ ...production(), ratingStrategy: 'none' }])).toBeNull()
  })

  it('drops a microphone activity when the host has no microphone', () => {
    expect(select([{ ...production(), needsMic: true }])).toBeNull()
    expect(
      select([{ ...production(), needsMic: true }], {
        capabilities: { ...V1_CAPABILITIES, mic: true },
      }),
    ).not.toBeNull()
  })

  it('drops a sandboxed activity when the host has no sandbox', () => {
    expect(select([{ ...production(), needsSandbox: true }])).toBeNull()
  })

  it('drops a media activity when media cannot be presented', () => {
    expect(select([{ ...production(), hasMedia: true }])).toBeNull()
  })

  it('drops the word bank under Legendary', () => {
    const bank = { ...production(), type: 'cloze_wordbank', progression: 'assisted' as const }
    expect(select([bank], { policy: 'legendary' })).toBeNull()
    expect(select([bank], { policy: 'standard' })).not.toBeNull()
  })
})

describe('the relaxation ladder', () => {
  it('lifts the 7-day cooldown first, before the stage rule', () => {
    const recent = { ...production(), lastServedAt: new Date(NOW.getTime() - 2 * DAY_MS) }
    const chosen = select([recent])
    expect(chosen?.rung).toBe(1)
    expect(chosen?.relaxed).toEqual(['cooldown'])
  })

  it('honours the cooldown when the activity is old enough', () => {
    const old = { ...production(), lastServedAt: new Date(NOW.getTime() - 8 * DAY_MS) }
    expect(select([old])?.rung).toBe(0)
  })

  it('lifts the no-two-in-a-row rule at rung 3', () => {
    const only = { ...production(), lastServedAt: new Date(NOW.getTime() - DAY_MS) }
    const chosen = select([only], {
      history: { ...EMPTY_ACTIVITY_HISTORY, lastType: only.type },
    })
    expect(chosen?.rung).toBe(3)
    expect(chosen?.relaxed).toEqual(['cooldown', 'stage', 'consecutive-type'])
  })

  it('prefers a different type over repeating the last one', () => {
    const repeat = production()
    const fresh = { ...production(), type: 'free_recall', family: 'long_text' as const }
    const chosen = select([repeat, fresh], {
      history: { ...EMPTY_ACTIVITY_HISTORY, lastType: repeat.type },
    })
    expect(chosen?.option.type).toBe('free_recall')
  })

  it('skips an activity already served in this session', () => {
    const served = production()
    const other = { ...production(), type: 'free_recall', family: 'long_text' as const }
    const chosen = select([served, other], {
      history: { ...EMPTY_ACTIVITY_HISTORY, servedActivityIds: new Set([served.activityId]) },
    })
    expect(chosen?.option.activityId).toBe(other.activityId)
  })
})

describe('the media budget', () => {
  const withMedia = { media: true, mic: false, sandbox: false }

  it('prefers a non-media activity once the budget is spent', () => {
    const media = { ...production(), hasMedia: true, type: 'image_choice' }
    const plain = { ...production(), type: 'free_recall', family: 'long_text' as const }
    const chosen = select([media, plain], {
      capabilities: withMedia,
      history: { ...EMPTY_ACTIVITY_HISTORY, mediaUsed: 2 },
    })
    expect(chosen?.option.hasMedia).toBe(false)
  })

  it('lifts the budget at rung 4 rather than falling back to the flashcard', () => {
    // A session of media-only cards must still serve activities; the cap is an attention
    // budget, not a correctness rule.
    const media = { ...production(), hasMedia: true }
    const chosen = select([media], {
      capabilities: withMedia,
      history: { ...EMPTY_ACTIVITY_HISTORY, mediaUsed: 2 },
    })
    expect(chosen?.rung).toBe(4)
    expect(chosen?.relaxed).toContain('media-cap')
  })

  it('respects a configured budget of zero', () => {
    const media = { ...production(), hasMedia: true }
    expect(select([media], { capabilities: withMedia, maxMediaPerSession: 0 })?.relaxed).toContain(
      'media-cap',
    )
  })
})

describe('determinism', () => {
  const pool = [
    { ...production(), activityId: 'a' },
    { ...production(), activityId: 'b' },
    { ...production(), activityId: 'c' },
  ]

  it('makes the same choice for the same seed', () => {
    expect(select(pool)?.option.activityId).toBe(select(pool)?.option.activityId)
  })

  it('does not depend on the order the caller supplied', () => {
    // Without the total order before the seeded pick, "deterministic" would quietly also
    // mean "whatever the repository's ORDER BY returned".
    const reversed = [...pool].reverse()
    expect(select(reversed)?.option.activityId).toBe(select(pool)?.option.activityId)
  })

  it('makes a different choice for a different seed', () => {
    // Guards against an implementation that ignores the seed entirely and so passes the
    // "same seed, same answer" test vacuously.
    const seeds = ['s1', 's2', 's3', 's4', 's5', 's6']
    const picks = new Set(seeds.map((seed) => select(pool, { seed })?.option.activityId))
    expect(picks.size).toBeGreaterThan(1)
  })

  it('prefers an activity that has never been served', () => {
    const fresh = { ...production(), activityId: 'zzz', lastServedAt: null }
    const stale = {
      ...production(),
      activityId: 'aaa',
      lastServedAt: new Date(NOW.getTime() - 30 * DAY_MS),
    }
    expect(select([stale, fresh])?.option.activityId).toBe('zzz')
  })
})

describe('presentation', () => {
  it('serves review mode with hints and immediate feedback by default', () => {
    const chosen = select([production()])
    expect(chosen?.mode).toBe('review')
    expect(chosen?.hintsAllowed).toBe(true)
    expect(chosen?.deferFeedback).toBe(false)
  })

  it('defers feedback and withholds hints in test mode', () => {
    const chosen = select([production()], { mode: 'test' })
    expect(chosen?.deferFeedback).toBe(true)
    expect(chosen?.hintsAllowed).toBe(false)
  })

  it('withholds hints under Legendary without deferring feedback', () => {
    const chosen = select([production()], { policy: 'legendary' })
    expect(chosen?.hintsAllowed).toBe(false)
    expect(chosen?.deferFeedback).toBe(false)
  })
})

describe('history', () => {
  it('folds a served selection into the budgets', () => {
    const media = { ...production(), hasMedia: true }
    const selection = select([media], { capabilities: { media: true, mic: false, sandbox: false } })
    const next = applySelection(EMPTY_ACTIVITY_HISTORY, selection as NonNullable<typeof selection>)
    expect(next.mediaUsed).toBe(1)
    expect(next.lastType).toBe(media.type)
    expect(next.servedActivityIds.has(media.activityId)).toBe(true)
  })

  it('rebuilds itself from the outcomes the session persists', () => {
    const first = production()
    const second = { ...production(), type: 'free_recall', hasMedia: true }
    const byId = new Map([first, second].map((option) => [option.activityId, option]))
    const history = historyFromOutcomes(
      [
        { activityId: first.activityId },
        { activityId: null },
        { activityId: 'vanished' },
        { activityId: second.activityId },
      ],
      (id) => byId.get(id),
    )
    expect(history.lastType).toBe('free_recall')
    expect(history.mediaUsed).toBe(1)
    expect(history.servedActivityIds.size).toBe(2)
  })
})

describe('the stateful selector', () => {
  it('is idempotent until the choice is committed', () => {
    // `SessionRunner.next()` is pure and the review screen re-calls it on every render; a
    // selector that spent its budget inside `select` would corrupt the session.
    const selector = createActivitySelector({ seed: SEED, clock: { now: () => NOW } })
    const entry = cardEntryFixture({ stability: 60 })
    const pool = [production()]
    expect(selector.select(entry, pool)?.option.activityId).toBe(
      selector.select(entry, pool)?.option.activityId,
    )
    expect(selector.history()).toEqual(EMPTY_ACTIVITY_HISTORY)
  })

  it('spends the budget only on commit', () => {
    const selector = createActivitySelector({
      seed: SEED,
      clock: { now: () => NOW },
      capabilities: { media: true, mic: false, sandbox: false },
      maxMediaPerSession: 2,
      repeatCooldownDays: 7,
      mode: 'study',
      policy: 'standard',
    })
    const entry = cardEntryFixture({ stability: 60 })
    const chosen = selector.select(entry, [{ ...production(), hasMedia: true }])
    selector.commit(chosen as NonNullable<typeof chosen>)
    expect(selector.history().mediaUsed).toBe(1)
    expect(chosen?.mode).toBe('study')
  })

  it('restores a history rebuilt after a resume', () => {
    const selector = createActivitySelector({ seed: SEED })
    const restored = { lastType: 'mcq_single', mediaUsed: 2, servedActivityIds: new Set(['x']) }
    selector.restore(restored)
    expect(selector.history()).toBe(restored)
  })
})

describe('applySelection', () => {
  it('leaves the media budget alone for a text activity', () => {
    const selection = select([production()])
    const next = applySelection(EMPTY_ACTIVITY_HISTORY, selection as NonNullable<typeof selection>)
    expect(next.mediaUsed).toBe(0)
    expect(next.lastType).toBe('short_answer')
  })
})
