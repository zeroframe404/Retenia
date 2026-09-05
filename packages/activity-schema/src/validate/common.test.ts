import { describe, expect, it } from 'vitest'
import type { Activity } from '../envelope'
import { sampleChoice, sampleDisclosure, sampleOrdering } from '../testing/samples'
import {
  duplicateIdIssues,
  leakIssues,
  mediaIssues,
  normalizedIncludes,
  registryIssues,
  sourceIssues,
  walk,
} from './common'

/** The rules every family shares (`docs/spec/03-activities.md` §11: "unique ids"; envelope consistency). */

const codes = (issues: { code: string }[]) => issues.map((issue) => issue.code)

describe('walk()', () => {
  it('visits every value with its path', () => {
    const paths: string[] = []
    walk({ a: [1, { b: 'x' }], c: null }, [], (_value, path) => paths.push(path.join('.')))
    expect(paths).toEqual(['', 'a', 'a.0', 'a.1', 'a.1.b', 'c'])
  })
})

describe('duplicateIdIssues()', () => {
  it('flags an id reused anywhere in the payload or the media list', () => {
    const activity = sampleChoice()
    expect(duplicateIdIssues(activity)).toEqual([])
    activity.payload.sets[0]?.options.push({ id: 'a', text: 'Niza', correct: false })
    const issues = duplicateIdIssues(activity)
    expect(codes(issues)).toEqual(['duplicate-id'])
    expect(issues[0]?.path).toEqual(['payload', 'sets', 0, 'options', 3, 'id'])
    const withMedia: Activity = {
      ...sampleChoice(),
      media: [{ id: 's1', kind: 'image', src: 'x' }],
    }
    expect(codes(duplicateIdIssues(withMedia))).toEqual(['duplicate-id'])
  })
})

describe('mediaIssues()', () => {
  it('requires every [[media:ID]] token and payload media id to be declared', () => {
    const base = sampleOrdering()
    const referenced: Activity = {
      ...base,
      prompt: 'Mirá [[media:m1]] y ordená.',
      hints: ['[[media:m2]]'],
      media: [{ id: 'm1', kind: 'image', src: 'sha256:1' }],
    }
    expect(codes(mediaIssues(referenced))).toEqual(['media-ref-unknown'])
    expect(mediaIssues(referenced)[0]?.path).toEqual(['hints', 0])
    const items = base.payload.items.map((item, i) => (i === 0 ? { ...item, media: 'm9' } : item))
    const payloadRef: Activity = { ...base, payload: { ...base.payload, items } }
    expect(codes(mediaIssues(payloadRef))).toEqual(['media-ref-unknown'])
  })

  it('flags a declared media entry that can neither be shown nor generated', () => {
    const activity: Activity = { ...sampleChoice(), media: [{ id: 'm1', kind: 'audio' }] }
    expect(codes(mediaIssues(activity))).toEqual(['media-unresolvable'])
    const generated: Activity = {
      ...sampleChoice(),
      media: [{ id: 'm1', kind: 'audio', generate: { by: 'tts', prompt: 'Hola' } }],
    }
    expect(mediaIssues(generated)).toEqual([])
  })

  it('accepts media ids listed on cards', () => {
    const activity: Activity = {
      ...sampleChoice(),
      family: 'cards',
      type: 'flashcard_basic',
      grading: { method: 'self' },
      review: { eligible: true, ratingStrategy: 'self' },
      media: [{ id: 'm1', kind: 'image', src: 'x' }],
      payload: {
        family: 'cards',
        presentation: 'grade',
        cards: [{ id: 'c1', front: 'a', back: 'b', media: ['m1', 'm2'] }],
      },
    }
    const issues = mediaIssues(activity)
    expect(codes(issues)).toEqual(['media-ref-unknown'])
    expect(issues[0]?.path).toEqual(['payload', 'cards', 0, 'media', 1])
  })
})

describe('sourceIssues()', () => {
  it('flags a span that ends before it starts', () => {
    const activity: Activity = {
      ...sampleChoice(),
      sources: [
        { docId: 'd', span: { start: 10, end: 5 } },
        { docId: 'd', span: 'p. 3' },
      ],
    }
    expect(codes(sourceIssues(activity))).toEqual(['source-span-inverted'])
  })
})

describe('registryIssues()', () => {
  it('holds review and grading to the registry row of the type, allowing documented alternates', () => {
    expect(registryIssues(sampleChoice())).toEqual([])
    expect(
      codes(
        registryIssues({
          ...sampleChoice(),
          review: { eligible: true, ratingStrategy: 'partial' },
        }),
      ),
    ).toEqual(['review-mismatch'])
    expect(
      codes(
        registryIssues({
          ...sampleChoice(),
          review: { eligible: false, ratingStrategy: 'binary' },
        }),
      ),
    ).toEqual(['review-mismatch'])
    expect(codes(registryIssues({ ...sampleChoice(), grading: { method: 'ai' } }))).toEqual([
      'grading-method-mismatch',
    ])
    const cloze: Activity = {
      ...sampleChoice(),
      family: 'cloze',
      type: 'cloze_typed',
      review: { eligible: true, ratingStrategy: 'binary' },
      grading: { method: 'det' },
      payload: {
        family: 'cloze',
        mode: 'typed',
        segments: [{ kind: 'gap', id: 'g', answers: ['x'] }],
      },
    }
    expect(registryIssues(cloze)).toEqual([])
  })

  it('requires skills on a review-eligible activity only', () => {
    expect(codes(registryIssues({ ...sampleChoice(), skills: [] }))).toEqual(['skills-required'])
    expect(registryIssues(sampleDisclosure())).toEqual([])
  })
})

describe('normalizedIncludes() and leakIssues()', () => {
  it('matches after normalization but ignores answers shorter than three characters', () => {
    expect(normalizedIncludes('La capital es PARÍS.', 'París')).toBe(true)
    expect(normalizedIncludes('Sí o no', 'no')).toBe(false)
    expect(normalizedIncludes('Sí o no', 'sí o')).toBe(true)
  })

  it('reports the answer in the prompt, a stem and a hint as warnings', () => {
    const activity: Activity = {
      ...sampleChoice(),
      prompt: '¿París es la capital de Francia?',
      hints: ['Empieza con P', 'Es París'],
    }
    const issues = leakIssues(
      activity,
      [{ text: 'París', path: ['payload', 'x'] }],
      [{ text: 'Sobre París', path: ['payload', 'sets', 0, 'stem'] }],
    )
    expect(issues.map((issue) => [issue.code, issue.severity, issue.path.join('.')])).toEqual([
      ['answer-in-prompt', 'warning', 'payload.x'],
      ['answer-in-prompt', 'warning', 'payload.x'],
      ['hint-reveals-answer', 'warning', 'hints.1'],
    ])
  })
})
