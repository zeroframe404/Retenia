import { ACTIVITY_TYPES, familyOf, MVP_TYPES } from '@retenia/activity-schema'
import { describe, expect, it } from 'vitest'
import '../index'
import {
  ActivityTypeError,
  defineActivityType,
  findActivityType,
  getActivityType,
  getRenderer,
  isActivityTypeRegistered,
  PROGRESSION_STAGES,
  registerActivityType,
  registeredActivityTypes,
  SOURCE_MODES,
} from './registry'
import { familyRenderer, hasRenderer } from './renderers'

describe('the activity type registry', () => {
  it('registers exactly the 21 MVP types of §6', () => {
    const registered = registeredActivityTypes().map((entry) => entry.type)
    expect([...registered].sort()).toEqual([...MVP_TYPES].sort())
  })

  it('registers no type whose family has no renderer yet', () => {
    for (const entry of registeredActivityTypes()) {
      expect(hasRenderer(entry.family)).toBe(true)
    }
  })

  it('takes the family and the rating strategy from the 98-row table, never from the file', () => {
    for (const entry of registeredActivityTypes()) {
      expect(entry.family).toBe(familyOf(entry.type))
      expect(entry.review.strategy).toBe(ACTIVITY_TYPES[entry.type].ratingStrategy)
      expect(entry.generator.schemaRef).toBe(entry.family)
    }
  })

  it('gives every type a grader, a validator and a complete generation spec', () => {
    for (const entry of registeredActivityTypes()) {
      expect(typeof entry.grader).toBe('function')
      expect(typeof entry.validate).toBe('function')
      expect(entry.generator.promptTemplate).toContain(entry.type)
      expect(entry.generator.itemsPerCall).toBeGreaterThan(0)
      expect(SOURCE_MODES).toContain(entry.generator.sourceMode)
      expect(PROGRESSION_STAGES).toContain(entry.review.progression)
      expect(entry.review.expectedSeconds).toBeGreaterThan(0)
    }
  })

  it('marks every MVP type as offline, hands-free and sandbox-free — the MVP is text only', () => {
    for (const entry of registeredActivityTypes()) {
      expect(entry.capabilities).toEqual({ offline: true, needsMic: false, needsSandbox: false })
    }
  })

  it('gives the theory type the `none` strategy and the practice types a real one', () => {
    expect(getActivityType('disclosure_block').review.strategy).toBe('none')
    expect(getActivityType('disclosure_block').review.progression).toBe('theory')
    expect(getActivityType('flashcard_basic').review.strategy).toBe('self')
    expect(getActivityType('mcq_single').review.strategy).toBe('binary')
  })

  it('freezes the entries so nothing can swap a renderer at runtime', () => {
    expect(Object.isFrozen(getActivityType('mcq_single'))).toBe(true)
  })
})

describe('getRenderer', () => {
  it('hands back one shared lazy component per family, not one per type', () => {
    expect(getRenderer('mcq_single')).toBe(getRenderer('true_false'))
    expect(getRenderer('mcq_single')).toBe(familyRenderer('choice'))
    expect(getRenderer('mcq_single')).not.toBe(getRenderer('short_answer'))
  })

  it('covers the ten MVP families with ten distinct renderers', () => {
    const renderers = new Set(registeredActivityTypes().map((entry) => entry.Renderer))
    expect(renderers.size).toBe(10)
  })

  it('throws for a type nobody has registered', () => {
    expect(() => getRenderer('hotspot_click')).toThrow(ActivityTypeError)
  })
})

describe('lookups', () => {
  it('isActivityTypeRegistered separates registered, known-but-unregistered and unknown', () => {
    expect(isActivityTypeRegistered('mcq_single')).toBe(true)
    expect(isActivityTypeRegistered('hotspot_click')).toBe(false)
    expect(isActivityTypeRegistered('not_a_type')).toBe(false)
  })

  it('findActivityType returns undefined instead of throwing', () => {
    expect(findActivityType('mcq_single')?.type).toBe('mcq_single')
    expect(findActivityType('hotspot_click')).toBeUndefined()
    expect(findActivityType('not_a_type')).toBeUndefined()
  })
})

describe('registerActivityType', () => {
  const entry = getActivityType('mcq_single')

  it('rejects a type id the master table does not know', () => {
    expect(() => registerActivityType({ ...entry, type: 'not_a_type' as never })).toThrow(
      /not one of the 98/,
    )
  })

  it('rejects a family that contradicts the master table', () => {
    expect(() =>
      registerActivityType({ ...entry, type: 'short_answer', family: 'choice' }),
    ).toThrow(/belongs to family "text_input"/)
  })

  it('rejects a duplicate registration rather than silently swapping the renderer', () => {
    expect(() => registerActivityType({ ...entry })).toThrow(/already registered/)
  })

  it('rejects a type of a family that has no renderer, unless one is passed', () => {
    expect(() =>
      defineActivityType({
        type: 'hotspot_click',
        generator: { promptTemplate: 'x', needsMedia: true, itemsPerCall: 1, sourceMode: 'chunk' },
        review: { expectedSeconds: 10, progression: 'recognition' },
      }),
    ).toThrow(/has no renderer yet/)
  })
})
