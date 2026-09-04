import { ACTIVITY_FAMILIES } from '@retenia/core'
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  type Activity,
  activityDraftSchema,
  activitySchema,
  familyBranch,
  familyDraftBranch,
  parseActivity,
  safeParseActivity,
  toActivityDraft,
} from './envelope'
import { typesOfFamily } from './registry'
import { sampleActivities, sampleChoice } from './testing/samples'

/** `ActivityBase<T, P>` of `docs/spec/03-activities.md` §7. */
describe('activitySchema', () => {
  it('parses one sample of every MVP family', () => {
    for (const sample of sampleActivities()) {
      const result = safeParseActivity(sample)
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true)
      expect(parseActivity(sample)).toEqual(sample)
    }
  })

  it('rejects a type that belongs to another family', () => {
    const result = safeParseActivity({ ...sampleChoice(), type: 'cloze_typed' })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown family, an unknown type and a mismatched payload family', () => {
    expect(safeParseActivity({ ...sampleChoice(), family: 'quiz' }).success).toBe(false)
    expect(safeParseActivity({ ...sampleChoice(), type: 'mcq' }).success).toBe(false)
    const sample = sampleChoice()
    expect(
      safeParseActivity({ ...sample, payload: { ...sample.payload, family: 'cards' } }).success,
    ).toBe(false)
  })

  it('rejects the envelope fields outside their ranges', () => {
    const base = sampleChoice()
    const rejects = (patch: Partial<Record<keyof Activity, unknown>>) =>
      expect(safeParseActivity({ ...base, ...patch }).success).toBe(false)
    rejects({ id: '0192f000-0000-4000-8000-000000000001' })
    rejects({ id: '01ARZ3NDEKTSV4RRFFQ69G5FAV' })
    rejects({ schemaVersion: 2 })
    rejects({ lang: 'ES' })
    rejects({ prompt: '' })
    rejects({ difficulty: 0 })
    rejects({ difficulty: 6 })
    rejects({ difficulty: 2.5 })
    rejects({ skills: ['', 'x'] })
    rejects({ hints: [''] })
    rejects({ grading: { method: 'magic' } })
    rejects({ review: { eligible: true, ratingStrategy: 'bin' } })
  })

  it('accepts every optional envelope field', () => {
    const full = {
      ...sampleChoice(),
      instructions: 'Elegí una.',
      media: [{ id: 'm1', kind: 'image', src: 'sha256:abc', alt: 'Mapa' }],
      hints: ['Empieza con P'],
      explanation: 'París es la capital desde hace siglos.',
      sources: [{ docId: 'doc-1', span: { start: 10, end: 40 }, quote: 'París…' }],
      tags: ['geografía'],
    }
    expect(safeParseActivity(full).success).toBe(true)
  })

  it('accepts a placeholder family with any payload shape, as long as family matches', () => {
    const speech = {
      ...sampleChoice(),
      family: 'speech',
      type: 'speak_repeat',
      review: { eligible: true, ratingStrategy: 'speech' },
      grading: { method: 'speech' },
      payload: { family: 'speech', mode: 'repeat', targetText: 'Hello', anything: [1, 2, 3] },
    }
    const parsed = parseActivity(speech)
    expect(parsed.payload).toEqual(speech.payload)
    expect(safeParseActivity({ ...speech, payload: { family: 'choice' } }).success).toBe(false)
  })

  it('narrows `type` per family at the type level', () => {
    expectTypeOf<Activity<'cards'>['type']>().toEqualTypeOf<
      'flashcard_basic' | 'flashcard_reverse' | 'dialog_cards'
    >()
    expectTypeOf<Activity<'choice'>['payload']['family']>().toEqualTypeOf<'choice'>()
  })
})

describe('familyBranch()', () => {
  it('limits `type` to the given allow-list', () => {
    const branch = familyBranch('choice', ['mcq_single', 'true_false'])
    expect(branch.safeParse(sampleChoice()).success).toBe(true)
    expect(branch.safeParse({ ...sampleChoice(), type: 'mcq_multi' }).success).toBe(false)
  })

  it('defaults to every type of the family', () => {
    const branch = familyBranch('choice')
    for (const type of typesOfFamily('choice')) {
      expect(branch.safeParse({ ...sampleChoice(), type }).success).toBe(true)
    }
  })

  it('throws on an empty list or a type of another family', () => {
    expect(() => familyBranch('choice', [])).toThrow(RangeError)
    // @ts-expect-error — the runtime check is what a JSON caller would hit
    expect(() => familyBranch('choice', ['cloze_typed'])).toThrow(/belongs to family "cloze"/)
  })
})

describe('activityDraftSchema', () => {
  it('is the activity without an id, and rejects one that has it', () => {
    const draft = toActivityDraft(sampleChoice())
    expect('id' in draft).toBe(false)
    expect(activityDraftSchema.safeParse(draft).success).toBe(true)
    // A full activity parses as a draft too: zod strips the id, which is exactly "without an id".
    const stripped = activityDraftSchema.parse(sampleChoice())
    expect('id' in stripped).toBe(false)
    expect(activitySchema.safeParse(draft).success).toBe(false)
    expect(familyDraftBranch('choice', ['mcq_single']).safeParse(draft).success).toBe(true)
  })

  it('has one branch per family of core', () => {
    expect(activitySchema.options).toHaveLength(ACTIVITY_FAMILIES.length)
    expect(activityDraftSchema.options).toHaveLength(ACTIVITY_FAMILIES.length)
  })
})
