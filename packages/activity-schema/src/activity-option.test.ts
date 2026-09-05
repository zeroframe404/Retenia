import { describe, expect, it } from 'vitest'
import { CHANCE_TYPES, toActivityOption } from './activity-option'
import { ACTIVITY_TYPE_LIST, capabilitiesOf, PROGRESSION_BY_TYPE, progressionOf } from './registry'
import { sampleChoice, sampleLongText } from './testing/samples'

describe('PROGRESSION_BY_TYPE', () => {
  it('classifies every one of the 98 types', () => {
    for (const meta of ACTIVITY_TYPE_LIST) {
      expect(PROGRESSION_BY_TYPE[meta.type], meta.type).toBeDefined()
    }
  })

  it('marks exactly the lesson-only rows as theory', () => {
    // §4's nine `N` rows are the ones that never feed the scheduler, and `theory` is in no
    // progression ladder — so the two lists have to be the same list.
    const theory = ACTIVITY_TYPE_LIST.filter((meta) => progressionOf(meta.type) === 'theory')
    const lessonOnly = ACTIVITY_TYPE_LIST.filter((meta) => !meta.reviewEligible)
    expect(theory.map((meta) => meta.type).sort()).toEqual(
      lessonOnly.map((meta) => meta.type).sort(),
    )
  })

  it('puts §5’s own examples on the rungs §5 names', () => {
    for (const type of ['mcq_single', 'true_false', 'cloze_dropdown'] as const) {
      expect(progressionOf(type), type).toBe('recognition')
    }
    for (const type of ['cloze_wordbank', 'sentence_builder', 'matching_pairs'] as const) {
      expect(progressionOf(type), type).toBe('assisted')
    }
    for (const type of ['cloze_typed', 'short_answer', 'free_recall'] as const) {
      expect(progressionOf(type), type).toBe('production')
    }
  })
})

describe('capabilitiesOf', () => {
  it('needs a microphone exactly for the speech family', () => {
    expect(capabilitiesOf('pronunciation_word').needsMic).toBe(true)
    expect(capabilitiesOf('mcq_single').needsMic).toBe(false)
  })

  it('needs the sandbox exactly for the code family', () => {
    // §10: code runs "in an isolated process with limits, never in the renderer".
    expect(capabilitiesOf('code_tests').needsSandbox).toBe(true)
    expect(capabilitiesOf('short_answer').needsSandbox).toBe(false)
  })
})

describe('toActivityOption', () => {
  it('joins what the content says with what the type says', () => {
    const activity = sampleChoice()
    expect(toActivityOption(activity)).toMatchObject({
      activityId: activity.id,
      type: 'mcq_single',
      family: 'choice',
      progression: 'recognition',
      eligible: true,
      hasMedia: false,
      needsMic: false,
      needsSandbox: false,
      conceptIds: activity.skills,
      lastServedAt: null,
      bloom: null,
    })
  })

  it('reads media from the activity rather than from the type', () => {
    const activity = sampleChoice()
    const withMedia = {
      ...activity,
      media: [{ id: 'm1', kind: 'image' as const, src: 'media://blob/abc' }],
    }
    expect(toActivityOption(withMedia).hasMedia).toBe(true)
    expect(toActivityOption(activity).hasMedia).toBe(false)
  })

  it('carries the last-served timestamp and the Bloom level through', () => {
    const at = new Date('2026-06-01T00:00:00.000Z')
    const option = toActivityOption(sampleChoice(), { lastServedAt: at, bloom: 'apply' })
    expect(option.lastServedAt).toBe(at)
    expect(option.bloom).toBe('apply')
  })

  it('keeps the rating strategy the envelope declares', () => {
    expect(toActivityOption(sampleLongText()).ratingStrategy).toBe('ai')
  })
})

describe('§5’s chance and noise types', () => {
  it('never offers a game with chance to the scheduler', () => {
    // §5: "types with chance or noise … do not feed the scheduler; they serve as reward and
    // variety". §4's own table rates them, which is the contradiction resolved here.
    for (const type of CHANCE_TYPES) {
      const activity = { ...sampleChoice(), type } as unknown as Parameters<
        typeof toActivityOption
      >[0]
      expect(toActivityOption(activity).eligible, type).toBe(false)
    }
  })

  it('leaves an ordinary reviewable type eligible', () => {
    expect(toActivityOption(sampleChoice()).eligible).toBe(true)
  })
})
