import type { BloomLevel } from '@retenia/core'
import { describe, expect, it } from 'vitest'
import { checkVariety, VARIETY_LIMITS } from './variety'

const activity = (type: string, bloom: BloomLevel | null = 'understand') => ({ type, bloom })

describe('checkVariety() — §5 gate 6', () => {
  it('passes a block of four to eight, three types, under 40 % MCQ, with an apply item', () => {
    const result = checkVariety({
      lessonSpecId: 'L01',
      activities: [
        activity('mcq_single', 'remember'),
        activity('cloze_typed', 'understand'),
        activity('short_answer', 'apply'),
        activity('free_recall', 'analyze'),
      ],
      module: null,
    })
    expect(result.outcome).toBe('pass')
    expect(result.findings).toEqual([])
  })

  it('reports every §4 rule a block of five MCQs breaks, as practice_incomplete warnings', () => {
    const result = checkVariety({
      lessonSpecId: 'L01',
      activities: Array.from({ length: 5 }, () => activity('mcq_single', 'remember')),
      module: null,
    })
    expect(result.outcome).toBe('fix')
    expect(result.findings.map((finding) => finding.sentence)).toEqual([
      'distinct_types',
      'mcq_share',
      'apply_bloom',
    ])
    expect(result.findings.every((finding) => finding.kind === 'variety_rule')).toBe(true)
    expect(result.warnings.map((entry) => entry.code)).toEqual([
      'practice_incomplete',
      'practice_incomplete',
      'practice_incomplete',
    ])
    expect(VARIETY_LIMITS.maxMcqShare).toBe(0.4)
  })

  it('reports a count outside 4–8', () => {
    const result = checkVariety({
      lessonSpecId: 'L01',
      activities: [
        activity('short_answer', 'apply'),
        activity('cloze_typed'),
        activity('mcq_single'),
      ],
      module: null,
    })
    expect(result.findings.map((finding) => finding.sentence)).toEqual(['count'])
  })

  it('lets each "Más ejemplos" round raise the count ceiling by a block', () => {
    const twelve = Array.from({ length: 12 }, (_, index) =>
      activity(
        index % 3 === 0 ? 'short_answer' : index % 3 === 1 ? 'cloze_typed' : 'ordering',
        'apply',
      ),
    )
    const base = checkVariety({ lessonSpecId: 'L01', activities: twelve, module: null })
    expect(base.findings.map((finding) => finding.sentence)).toEqual(['count'])
    const appended = checkVariety({
      lessonSpecId: 'L01',
      activities: twelve,
      module: null,
      variantRounds: 1,
    })
    expect(appended.outcome).toBe('pass')
    expect(appended.findings).toEqual([])
  })

  it('needs three Bloom levels across the module, once every lesson has its practice', () => {
    const block = [
      activity('mcq_single', 'apply'),
      activity('cloze_typed', 'apply'),
      activity('short_answer', 'apply'),
      activity('free_recall', 'apply'),
    ]
    const result = checkVariety({
      lessonSpecId: 'L02',
      activities: block,
      module: { specId: 'M01', activities: [...block, ...block] },
    })
    expect(result.findings.map((finding) => finding.kind)).toEqual(['module_bloom_variety'])
    expect(result.warnings.map((entry) => entry.code)).toEqual(['module_bloom_variety'])
    expect(result.warnings[0]?.params).toMatchObject({ module: 'M01', levels: ['apply'] })
  })
})
