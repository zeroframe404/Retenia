import type { LessonKind } from '@retenia/core'
import { describe, expect, it } from 'vitest'
import { type PlacementLesson, placeRemediation } from './placement'

function lesson(overrides: Partial<PlacementLesson> & { id: string }): PlacementLesson {
  return {
    specId: overrides.id,
    moduleId: 'm1',
    kind: 'core',
    parentLessonId: null,
    conceptIds: [],
    prerequisiteLessonIds: [],
    completed: false,
    ...overrides,
  }
}

describe('placeRemediation()', () => {
  it('anchors an explicit core lesson, after it', () => {
    const lessons = [
      lesson({ id: 'L01', completed: true }),
      lesson({ id: 'L02', completed: false }),
    ]
    const placement = placeRemediation({ lessons, conceptId: 'c1', lessonId: 'L02' })
    expect(placement).toEqual({
      anchorLessonId: 'L02',
      anchorSpecId: 'L02',
      moduleId: 'm1',
      position: 'after',
      teachingLessonId: null,
    })
  })

  it('anchors an explicit reinforcement lesson at the last core lesson of its module before it', () => {
    const lessons = [
      lesson({ id: 'L01', completed: true }),
      lesson({ id: 'L02', completed: true }),
      lesson({ id: 'Rf1', kind: 'reinforcement' as LessonKind, moduleId: 'm1' }),
      lesson({ id: 'L03', completed: false }),
    ]
    const placement = placeRemediation({ lessons, conceptId: 'c1', lessonId: 'Rf1' })
    expect(placement?.anchorLessonId).toBe('L02')
    expect(placement?.position).toBe('after')
  })

  it('anchors an explicit remediation lesson at its parentLessonId', () => {
    const lessons = [
      lesson({ id: 'L01', completed: true }),
      lesson({ id: 'L02', completed: false }),
      lesson({
        id: 'L02.r1',
        kind: 'remediation' as LessonKind,
        parentLessonId: 'L01',
      }),
    ]
    const placement = placeRemediation({ lessons, conceptId: 'c1', lessonId: 'L02.r1' })
    expect(placement?.anchorLessonId).toBe('L01')
    expect(placement?.position).toBe('after')
  })

  it('places after the lesson that teaches the concept, when that lesson is not yet completed', () => {
    const lessons = [
      lesson({ id: 'L01', completed: true }),
      lesson({ id: 'L02', completed: false }),
      lesson({ id: 'L03', completed: false, conceptIds: ['c1'] }),
      lesson({ id: 'L04', completed: false }),
    ]
    const placement = placeRemediation({ lessons, conceptId: 'c1', lessonId: null })
    expect(placement?.anchorLessonId).toBe('L03')
    expect(placement?.position).toBe('after')
    expect(placement?.teachingLessonId).toBe('L03')
  })

  it('places before the current lesson when it carries the concept itself', () => {
    const lessons = [
      lesson({ id: 'L01', completed: true, conceptIds: ['c1'] }),
      lesson({ id: 'L02', completed: false, conceptIds: ['c1'] }),
      lesson({ id: 'L03', completed: false }),
    ]
    const placement = placeRemediation({ lessons, conceptId: 'c1', lessonId: null })
    expect(placement?.anchorLessonId).toBe('L02')
    expect(placement?.position).toBe('before')
    expect(placement?.teachingLessonId).toBe('L01')
  })

  it('places before the current lesson when it lists the teaching lesson as a prerequisite', () => {
    const lessons = [
      lesson({ id: 'L01', completed: true, conceptIds: ['c1'] }),
      lesson({ id: 'L02', completed: false, prerequisiteLessonIds: ['L01'] }),
      lesson({ id: 'L03', completed: false }),
    ]
    const placement = placeRemediation({ lessons, conceptId: 'c1', lessonId: null })
    expect(placement?.anchorLessonId).toBe('L02')
    expect(placement?.position).toBe('before')
  })

  it('otherwise places after the last completed core lesson', () => {
    const lessons = [
      lesson({ id: 'L01', completed: true, conceptIds: ['c1'] }),
      lesson({ id: 'L02', completed: true }),
      lesson({ id: 'L03', completed: false }),
    ]
    const placement = placeRemediation({ lessons, conceptId: 'c1', lessonId: null })
    expect(placement?.anchorLessonId).toBe('L02')
    expect(placement?.position).toBe('after')
  })

  it('places after the teaching lesson when every core lesson is completed', () => {
    const lessons = [
      lesson({ id: 'L01', completed: true, conceptIds: ['c1'] }),
      lesson({ id: 'L02', completed: true }),
    ]
    const placement = placeRemediation({ lessons, conceptId: 'c1', lessonId: null })
    expect(placement?.anchorLessonId).toBe('L01')
    expect(placement?.position).toBe('after')
  })

  it('places after the last core lesson when the path is finished and nothing teaches the concept', () => {
    const lessons = [lesson({ id: 'L01', completed: true }), lesson({ id: 'L02', completed: true })]
    const placement = placeRemediation({ lessons, conceptId: 'zzz', lessonId: null })
    expect(placement?.anchorLessonId).toBe('L02')
    expect(placement?.position).toBe('after')
    expect(placement?.teachingLessonId).toBeNull()
  })

  it('returns null when there is no core lesson at all', () => {
    const lessons = [lesson({ id: 'Rf1', kind: 'reinforcement' as LessonKind })]
    const placement = placeRemediation({ lessons, conceptId: 'c1', lessonId: null })
    expect(placement).toBeNull()
  })

  it('places before the first lesson when it is current and does not depend on the concept', () => {
    const lessons = [
      lesson({ id: 'L01', completed: false }),
      lesson({ id: 'L02', completed: false }),
    ]
    const placement = placeRemediation({ lessons, conceptId: 'c1', lessonId: null })
    expect(placement?.anchorLessonId).toBe('L01')
    expect(placement?.position).toBe('before')
    expect(placement?.teachingLessonId).toBeNull()
  })

  it('reports the anchor module id', () => {
    const lessons = [
      lesson({ id: 'L01', moduleId: 'mA', completed: true, conceptIds: ['c1'] }),
      lesson({ id: 'L02', moduleId: 'mB', completed: false }),
    ]
    const placement = placeRemediation({ lessons, conceptId: 'c1', lessonId: null })
    expect(placement?.moduleId).toBe('mA')
  })
})
