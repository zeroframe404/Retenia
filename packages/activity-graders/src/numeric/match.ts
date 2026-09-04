import { normalizeText } from '../text/normalize'
import type { ParsedNumber } from './parse'

/** Numeric tolerance and unit handling (`docs/spec/03-activities.md` §4 row 6: "tolerance, units"). */

export interface UnitDefinition {
  dimension: string
  /** Multiplier to the dimension's base unit. */
  factor: number
}

/** Canonical units with their common English and Spanish spellings; keys are normalized. */
export const UNIT_TABLE: Readonly<Record<string, UnitDefinition>> = Object.freeze({
  mm: { dimension: 'length', factor: 0.001 },
  milimetro: { dimension: 'length', factor: 0.001 },
  milimetros: { dimension: 'length', factor: 0.001 },
  cm: { dimension: 'length', factor: 0.01 },
  centimetro: { dimension: 'length', factor: 0.01 },
  centimetros: { dimension: 'length', factor: 0.01 },
  m: { dimension: 'length', factor: 1 },
  metro: { dimension: 'length', factor: 1 },
  metros: { dimension: 'length', factor: 1 },
  km: { dimension: 'length', factor: 1000 },
  kilometro: { dimension: 'length', factor: 1000 },
  kilometros: { dimension: 'length', factor: 1000 },
  mg: { dimension: 'mass', factor: 0.000001 },
  g: { dimension: 'mass', factor: 0.001 },
  gramo: { dimension: 'mass', factor: 0.001 },
  gramos: { dimension: 'mass', factor: 0.001 },
  kg: { dimension: 'mass', factor: 1 },
  kilo: { dimension: 'mass', factor: 1 },
  kilos: { dimension: 'mass', factor: 1 },
  kilogramo: { dimension: 'mass', factor: 1 },
  kilogramos: { dimension: 'mass', factor: 1 },
  ms: { dimension: 'time', factor: 0.001 },
  s: { dimension: 'time', factor: 1 },
  seg: { dimension: 'time', factor: 1 },
  segundo: { dimension: 'time', factor: 1 },
  segundos: { dimension: 'time', factor: 1 },
  min: { dimension: 'time', factor: 60 },
  minuto: { dimension: 'time', factor: 60 },
  minutos: { dimension: 'time', factor: 60 },
  h: { dimension: 'time', factor: 3600 },
  hora: { dimension: 'time', factor: 3600 },
  horas: { dimension: 'time', factor: 3600 },
  '%': { dimension: 'ratio', factor: 1 },
  pct: { dimension: 'ratio', factor: 1 },
})

export function canonicalUnit(unit: string): string {
  return normalizeText(unit)
}

/** `value` in `from`, expressed in `to`; `null` when either unit is unknown or they differ in dimension. */
export function convertUnit(value: number, from: string, to: string): number | null {
  const source = UNIT_TABLE[canonicalUnit(from)]
  const target = UNIT_TABLE[canonicalUnit(to)]
  if (source === undefined || target === undefined || source.dimension !== target.dimension)
    return null
  return (value * source.factor) / target.factor
}

export interface NumericMatchOptions {
  /** Absolute tolerance; default 0. */
  abs?: number
  /** Relative tolerance, as a fraction of the expected value; default 0. */
  rel?: number
  /** The unit the expected value is in. Absent: units are ignored. */
  unit?: string
  /** Other spellings accepted as the expected unit without conversion. */
  units?: readonly string[]
}

export interface NumericMatch {
  matched: boolean
  /** The user's value in the expected unit; absent when the unit could not be reconciled. */
  converted?: number
}

/** A rounding-error floor so `3.15 − 3.14 ≤ 0.01` holds in floating point. */
const EPSILON = 1e-9

export function numericMatches(
  got: ParsedNumber,
  expected: number,
  options: NumericMatchOptions = {},
): NumericMatch {
  let value = got.value
  if (options.unit !== undefined && got.unit !== undefined) {
    const accepted = [options.unit, ...(options.units ?? [])].map(canonicalUnit)
    if (!accepted.includes(canonicalUnit(got.unit))) {
      const converted = convertUnit(got.value, got.unit, options.unit)
      if (converted === null) return { matched: false }
      value = converted
    }
  }
  const tolerance = Math.max(options.abs ?? 0, (options.rel ?? 0) * Math.abs(expected), EPSILON)
  return { matched: Math.abs(value - expected) <= tolerance, converted: value }
}
