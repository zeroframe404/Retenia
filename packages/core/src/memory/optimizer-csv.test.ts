import { describe, expect, it } from 'vitest'
import { reviewLogFixture } from '../testing/memory-fixtures'
import {
  formatOptimizerCsv,
  OPTIMIZER_CSV_HEADER,
  parseOptimizerCsv,
  toOptimizerCsv,
  toOptimizerCsvRows,
} from './optimizer-csv'

describe('§16 — toOptimizerCsvRows / toOptimizerCsv round-trip', () => {
  it('header is exactly the five documented columns', () => {
    expect(OPTIMIZER_CSV_HEADER).toBe(
      'card_id,review_time,review_rating,review_state,review_duration',
    )
  })

  it('drops rating 0 (Manual) rows', () => {
    const logs = [
      reviewLogFixture({ id: '1', cardId: 'card-a', rating: 0 }),
      reviewLogFixture({ id: '2', cardId: 'card-a', rating: 3 }),
    ]
    const rows = toOptimizerCsvRows(logs)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.reviewRating).toBe(3)
  })

  it('drops soft-deleted rows', () => {
    const logs = [
      reviewLogFixture({ id: '1', cardId: 'card-a', rating: 3, deletedAt: new Date('2026-02-01') }),
      reviewLogFixture({ id: '2', cardId: 'card-a', rating: 3 }),
    ]
    const rows = toOptimizerCsvRows(logs)
    expect(rows).toHaveLength(1)
  })

  it('sorts oldest first, ties broken by card id', () => {
    const t0 = new Date('2026-01-01T00:00:00.000Z')
    const t1 = new Date('2026-01-02T00:00:00.000Z')
    const logs = [
      reviewLogFixture({ id: '1', cardId: 'card-b', rating: 3, review: t1 }),
      reviewLogFixture({ id: '2', cardId: 'card-a', rating: 3, review: t1 }),
      reviewLogFixture({ id: '3', cardId: 'card-z', rating: 3, review: t0 }),
    ]
    const rows = toOptimizerCsvRows(logs)
    expect(rows.map((row) => row.cardId)).toEqual(['card-z', 'card-a', 'card-b'])
  })

  it('breaks a tie both ways, whichever order the ids compare', () => {
    const t = new Date('2026-01-02T00:00:00.000Z')
    // 'card-a' < 'card-b': the comparator's true branch (-1).
    const aFirst = toOptimizerCsvRows([
      reviewLogFixture({ id: '1', cardId: 'card-a', rating: 3, review: t }),
      reviewLogFixture({ id: '2', cardId: 'card-b', rating: 3, review: t }),
    ])
    expect(aFirst.map((row) => row.cardId)).toEqual(['card-a', 'card-b'])

    // 'card-b' < 'card-a' is false: the comparator's false branch (1).
    const bFirst = toOptimizerCsvRows([
      reviewLogFixture({ id: '1', cardId: 'card-b', rating: 3, review: t }),
      reviewLogFixture({ id: '2', cardId: 'card-a', rating: 3, review: t }),
    ])
    expect(bFirst.map((row) => row.cardId)).toEqual(['card-a', 'card-b'])
  })

  it('renders durationMs: null as 0', () => {
    const logs = [reviewLogFixture({ id: '1', cardId: 'card-a', rating: 3, durationMs: null })]
    const rows = toOptimizerCsvRows(logs)
    expect(rows[0]?.reviewDuration).toBe(0)
  })

  it('round-trips through toOptimizerCsv and parseOptimizerCsv', () => {
    const logs = [
      reviewLogFixture({
        id: '1',
        cardId: 'card-a',
        rating: 3,
        state: 2,
        review: new Date('2026-01-01T00:00:00.000Z'),
        durationMs: 4200,
      }),
      reviewLogFixture({
        id: '2',
        cardId: 'card-b',
        rating: 1,
        state: 0,
        review: new Date('2026-01-02T00:00:00.000Z'),
        durationMs: null,
      }),
    ]
    const csv = toOptimizerCsv(logs)
    const parsed = parseOptimizerCsv(csv)
    expect(parsed).toEqual(toOptimizerCsvRows(logs))
  })
})

describe('formatOptimizerCsv', () => {
  it('throws when a card id contains a comma, quote, CR or LF', () => {
    const base = { reviewTime: 0, reviewRating: 3, reviewState: 2, reviewDuration: 0 }
    expect(() => formatOptimizerCsv([{ ...base, cardId: 'a,b' }])).toThrow(RangeError)
    expect(() => formatOptimizerCsv([{ ...base, cardId: 'a"b' }])).toThrow(RangeError)
    expect(() => formatOptimizerCsv([{ ...base, cardId: 'a\rb' }])).toThrow(RangeError)
    expect(() => formatOptimizerCsv([{ ...base, cardId: 'a\nb' }])).toThrow(RangeError)
  })

  it('renders no rows as just the header plus newline', () => {
    expect(formatOptimizerCsv([])).toBe(`${OPTIMIZER_CSV_HEADER}\n`)
  })
})

describe('parseOptimizerCsv', () => {
  it('throws on a wrong header', () => {
    expect(() => parseOptimizerCsv('not,the,right,header,line\na,1,2,3,4\n')).toThrow(RangeError)
  })

  it('throws on a line with the wrong column count', () => {
    const csv = `${OPTIMIZER_CSV_HEADER}\ncard-a,1,2,3\n`
    expect(() => parseOptimizerCsv(csv)).toThrow(RangeError)
  })

  it('tolerates a trailing newline and blank lines', () => {
    const csv = `${OPTIMIZER_CSV_HEADER}\n\ncard-a,1000,3,2,500\n\n`
    const parsed = parseOptimizerCsv(csv)
    expect(parsed).toEqual([
      { cardId: 'card-a', reviewTime: 1000, reviewRating: 3, reviewState: 2, reviewDuration: 500 },
    ])
  })

  it('parses a header-only CSV into an empty array', () => {
    expect(parseOptimizerCsv(`${OPTIMIZER_CSV_HEADER}\n`)).toEqual([])
  })
})
