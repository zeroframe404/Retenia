import type { JsonObject, JsonValue } from '@retenia/core'

/**
 * The conversions every codec repeats: Unix milliseconds ⇄ `Date`, SQLite's 0/1 ⇄
 * `boolean`, and the JSON columns' null handling.
 *
 * Timestamp columns are bare `integer`s (no Drizzle `{ mode: 'timestamp' }`), so nothing is
 * converted for us — deliberately, because the FSRS columns must stay byte-identical to
 * what `ts-fsrs` reads and writes.
 */

/** A stored timestamp → `Date`. */
export function toDate(value: unknown): Date {
  return new Date(value as number)
}

/** A nullable stored timestamp → `Date | null`. */
export function toDateOrNull(value: unknown): Date | null {
  return value === null || value === undefined ? null : new Date(value as number)
}

/** `Date` → the stored integer. */
export function fromDate(value: Date): number {
  return value.getTime()
}

export function fromDateOrNull(value: Date | null | undefined): number | null {
  return value === null || value === undefined ? null : value.getTime()
}

export function toBool(value: unknown): boolean {
  return value === 1 || value === true
}

export function toBoolOrNull(value: unknown): boolean | null {
  return value === null || value === undefined ? null : toBool(value)
}

export function fromBool(value: boolean): number {
  return value ? 1 : 0
}

export function fromBoolOrNull(value: boolean | null | undefined): number | null {
  return value === null || value === undefined ? null : fromBool(value)
}

export function toText(value: unknown): string {
  return value as string
}

export function toTextOrNull(value: unknown): string | null {
  return (value ?? null) as string | null
}

export function toNumber(value: unknown): number {
  return value as number
}

export function toNumberOrNull(value: unknown): number | null {
  return (value ?? null) as number | null
}

export function toJsonObject(value: unknown): JsonObject {
  return (value ?? {}) as JsonObject
}

export function toJsonObjectOrNull(value: unknown): JsonObject | null {
  return (value ?? null) as JsonObject | null
}

export function toJsonArray(value: unknown): JsonValue[] {
  return (value ?? []) as JsonValue[]
}

export function toStringArray(value: unknown): string[] {
  return (value ?? []) as string[]
}

export function toJsonValueOrNull(value: unknown): JsonValue | null {
  return (value ?? null) as JsonValue | null
}

/**
 * Drops the keys a patch did not mention, so `undefined` never reaches the driver as SQL
 * `NULL`. Explicit `null`s survive — that is how a caller clears a nullable column.
 */
export function defined(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) out[key] = value
  }
  return out
}
