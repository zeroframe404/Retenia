import { describe, expect, it } from 'vitest'
import type { Activity } from '../envelope'
import { sampleCategorize } from '../testing/samples'
import { validateCategorize } from './categorize'

const patch = (payload: Partial<Activity<'categorize'>['payload']>): Activity<'categorize'> => {
  const base = sampleCategorize()
  return { ...base, payload: { ...base.payload, ...payload } }
}

describe('validateCategorize()', () => {
  it('passes the sample', () => {
    expect(validateCategorize(sampleCategorize())).toEqual([])
  })

  it('category-unknown is an error; unused categories and all-category items are warnings', () => {
    const items = sampleCategorize().payload.items
    const unknown = validateCategorize(
      patch({ items: [{ id: 'i1', text: 'Perro', categoryIds: ['c9'] }, ...items.slice(1)] }),
    )
    expect(unknown.map((issue) => [issue.code, issue.severity])).toEqual([
      ['category-unknown', 'error'],
    ])
    const unused = validateCategorize(
      patch({
        categories: [...sampleCategorize().payload.categories, { id: 'c3', label: 'Peces' }],
      }),
    )
    expect(unused.map((issue) => [issue.code, issue.severity])).toEqual([
      ['category-unused', 'warning'],
    ])
    const everywhere = validateCategorize(
      patch({
        items: [{ id: 'i1', text: 'Ornitorrinco', categoryIds: ['c1', 'c2'] }, ...items.slice(1)],
      }),
    )
    expect(everywhere.map((issue) => issue.code)).toEqual(['categorize-item-all-categories'])
  })
})
