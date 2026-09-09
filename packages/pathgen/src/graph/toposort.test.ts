import { describe, expect, it } from 'vitest'
import { compareStrings } from './order'
import { priorityTopologicalOrder } from './toposort'

describe('priorityTopologicalOrder()', () => {
  it('returns nothing for nothing', () => {
    expect(priorityTopologicalOrder([], [], compareStrings)).toEqual([])
  })

  it('places every prerequisite before what depends on it', () => {
    const order = priorityTopologicalOrder(
      ['d', 'c', 'b', 'a'],
      [
        ['a', 'b'],
        ['b', 'c'],
        ['a', 'd'],
      ],
      compareStrings,
    )
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'))
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'))
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('d'))
  })

  it('breaks ties with the comparator, not with the input order', () => {
    expect(priorityTopologicalOrder(['c', 'b', 'a'], [], compareStrings)).toEqual(['a', 'b', 'c'])
    // `z` is unblocked from the start but the comparator prefers `a`, and once `a` is placed
    // `b` becomes ready and still beats `z`.
    expect(priorityTopologicalOrder(['z', 'b', 'a'], [['a', 'b']], compareStrings)).toEqual([
      'a',
      'b',
      'z',
    ])
  })

  it('falls back to the input position when the comparator cannot decide', () => {
    const none = () => 0
    expect(priorityTopologicalOrder(['c', 'a', 'b'], [], none)).toEqual(['c', 'a', 'b'])
    expect(priorityTopologicalOrder(['c', 'a', 'b'], [['b', 'c']], none)).toEqual(['a', 'b', 'c'])
  })

  it('ignores edges whose endpoints are not items', () => {
    expect(
      priorityTopologicalOrder(
        ['b', 'a'],
        [
          ['ghost', 'a'],
          ['a', 'ghost'],
        ],
        compareStrings,
      ),
    ).toEqual(['a', 'b'])
  })

  it('counts a duplicated edge twice and still releases the node', () => {
    expect(
      priorityTopologicalOrder(
        ['b', 'a'],
        [
          ['a', 'b'],
          ['a', 'b'],
        ],
        compareStrings,
      ),
    ).toEqual(['a', 'b'])
  })

  it('appends the members of an unbroken cycle in comparator order rather than dropping them', () => {
    const order = priorityTopologicalOrder(
      ['y', 'x', 'free'],
      [
        ['x', 'y'],
        ['y', 'x'],
      ],
      compareStrings,
    )
    expect(order).toEqual(['free', 'x', 'y'])
  })

  it('works over objects by identity', () => {
    const a = { id: 'a' }
    const b = { id: 'b' }
    const order = priorityTopologicalOrder([b, a], [[a, b]], (x, y) => compareStrings(x.id, y.id))
    expect(order).toEqual([a, b])
  })
})
