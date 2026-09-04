/**
 * Reads what a user types into a numeric answer: `3,14`, `1.234,56`, `1,234,567`, `-2e3`,
 * `1500 m`, `25 %`. Decimal comma and decimal point are both accepted — when both separators
 * appear, the last one is the decimal mark; when one separator repeats it is a thousands
 * separator; a single separator is a decimal mark.
 */

export interface ParsedNumber {
  value: number
  /** The unit suffix as typed, when there is one. */
  unit?: string
}

const NUMBER =
  /^\s*([+-]?)\s*(\d[\d.,]*|[.,]\d+)(?:[eE]([+-]?\d+))?\s*(%|[\p{L}°][\p{L}\p{N}°/]*)?\s*$/u

function digits(text: string): string {
  const commas = (text.match(/,/g) ?? []).length
  const dots = (text.match(/\./g) ?? []).length
  if (commas > 0 && dots > 0) {
    const decimal = text.lastIndexOf(',') > text.lastIndexOf('.') ? ',' : '.'
    const thousands = decimal === ',' ? '.' : ','
    return text.split(thousands).join('').replace(decimal, '.')
  }
  const separator = commas > 0 ? ',' : dots > 0 ? '.' : null
  if (separator === null) return text
  const count = separator === ',' ? commas : dots
  return count > 1 ? text.split(separator).join('') : text.replace(separator, '.')
}

/** After the separators are resolved there must be at most one decimal mark left. */
const CANONICAL = /^(\d+\.?\d*|\.\d+)$/

export function parseNumber(input: string): ParsedNumber | null {
  const match = NUMBER.exec(input.replace(/−/gu, '-'))
  if (match === null) return null
  const [, sign, body, exponent, unit] = match
  const canonical = digits(body as string)
  if (!CANONICAL.test(canonical)) return null
  const value = Number.parseFloat(
    `${sign}${canonical}${exponent === undefined ? '' : `e${exponent}`}`,
  )
  if (!Number.isFinite(value)) return null
  return unit === undefined ? { value } : { value, unit }
}
