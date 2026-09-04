import { mulberry32 } from '@retenia/core'
import { describe, expect, it } from 'vitest'
import { parseNumber } from './parse'

describe('parseNumber()', () => {
  it('reads decimal commas and points, thousands separators, signs and exponents', () => {
    expect(parseNumber('3,14')).toEqual({ value: 3.14 })
    expect(parseNumber('3.14')).toEqual({ value: 3.14 })
    expect(parseNumber('1.234,56')).toEqual({ value: 1234.56 })
    expect(parseNumber('1,234.56')).toEqual({ value: 1234.56 })
    expect(parseNumber('1,234,567')).toEqual({ value: 1234567 })
    expect(parseNumber('1.234.567')).toEqual({ value: 1234567 })
    expect(parseNumber('-2e3')).toEqual({ value: -2000 })
    expect(parseNumber('−7')).toEqual({ value: -7 })
    expect(parseNumber('+ 4')).toEqual({ value: 4 })
    expect(parseNumber(',5')).toEqual({ value: 0.5 })
    expect(parseNumber('42')).toEqual({ value: 42 })
  })

  it('keeps a unit suffix as typed', () => {
    expect(parseNumber('1500 m')).toEqual({ value: 1500, unit: 'm' })
    expect(parseNumber('1,5km')).toEqual({ value: 1.5, unit: 'km' })
    expect(parseNumber('25%')).toEqual({ value: 25, unit: '%' })
    expect(parseNumber('25 %')).toEqual({ value: 25, unit: '%' })
    expect(parseNumber('9.8 m/s2')).toEqual({ value: 9.8, unit: 'm/s2' })
    expect(parseNumber('30 °C')).toEqual({ value: 30, unit: '°C' })
  })

  it('returns null for text, empty input and non-finite values', () => {
    for (const input of ['', 'pi', 'un cuarto', '3 apples 4', '1e999', '..', '1,2,3.4.5x']) {
      expect(parseNumber(input), input).toBeNull()
    }
  })

  it('round-trips random finite numbers written with a point', () => {
    const random = mulberry32(0x4242)
    for (let i = 0; i < 300; i++) {
      const value = (random() - 0.5) * 10 ** Math.floor(random() * 8)
      const text = value.toString()
      expect(parseNumber(text)?.value).toBeCloseTo(value, 6)
      expect(parseNumber(text.replace('.', ','))?.value).toBeCloseTo(value, 6)
    }
  })
})
