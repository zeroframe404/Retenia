import { describe, expect, it } from 'vitest'
import { canonicalUnit, convertUnit, numericMatches } from './match'

describe('numericMatches()', () => {
  it('applies absolute and relative tolerance, whichever is larger', () => {
    expect(numericMatches({ value: 3.15 }, 3.14, { abs: 0.01 })).toEqual({
      matched: true,
      converted: 3.15,
    })
    expect(numericMatches({ value: 3.2 }, 3.14, { abs: 0.01 })).toEqual({
      matched: false,
      converted: 3.2,
    })
    expect(numericMatches({ value: 101 }, 100, { rel: 0.01 }).matched).toBe(true)
    expect(numericMatches({ value: 102 }, 100, { rel: 0.01 }).matched).toBe(false)
    expect(numericMatches({ value: 105 }, 100, { abs: 1, rel: 0.05 }).matched).toBe(true)
    expect(numericMatches({ value: 100.0000000001 }, 100).matched).toBe(true)
    expect(numericMatches({ value: 100.001 }, 100).matched).toBe(false)
  })

  it('ignores the unit when the activity expects none', () => {
    expect(numericMatches({ value: 5, unit: 'km' }, 5)).toEqual({ matched: true, converted: 5 })
  })

  it('assumes the expected unit when none is typed, accepts listed spellings, converts the rest', () => {
    expect(numericMatches({ value: 1.5 }, 1.5, { unit: 'km' })).toEqual({
      matched: true,
      converted: 1.5,
    })
    expect(
      numericMatches({ value: 1.5, unit: 'kilómetros' }, 1.5, {
        unit: 'km',
        units: ['kilómetros'],
      }),
    ).toEqual({ matched: true, converted: 1.5 })
    expect(numericMatches({ value: 1500, unit: 'm' }, 1.5, { unit: 'km' })).toEqual({
      matched: true,
      converted: 1.5,
    })
    expect(numericMatches({ value: 90, unit: 'min' }, 1.5, { unit: 'h' })).toEqual({
      matched: true,
      converted: 1.5,
    })
    expect(numericMatches({ value: 1.5, unit: 'kg' }, 1.5, { unit: 'km' })).toEqual({
      matched: false,
    })
    expect(numericMatches({ value: 1.5, unit: 'parsec' }, 1.5, { unit: 'km' })).toEqual({
      matched: false,
    })
    expect(numericMatches({ value: 25, unit: '%' }, 25, { unit: '%' }).matched).toBe(true)
  })
})

describe('convertUnit() and canonicalUnit()', () => {
  it('converts within a dimension and refuses across dimensions or unknown units', () => {
    expect(convertUnit(1, 'km', 'm')).toBe(1000)
    expect(convertUnit(250, 'g', 'kg')).toBe(0.25)
    expect(convertUnit(2, 'Horas', 'min')).toBe(120)
    expect(convertUnit(1, 'km', 'kg')).toBeNull()
    expect(convertUnit(1, 'furlong', 'm')).toBeNull()
    expect(convertUnit(1, 'm', 'furlong')).toBeNull()
    expect(canonicalUnit(' Kilómetros ')).toBe('kilometros')
  })
})
