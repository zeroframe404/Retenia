import type { Chunk, JsonObject, SourceLocator } from './entities'

/**
 * Reads the `locator` JSON column into a `SourceLocator`. Pure, total and defensive: the
 * column is written by ingestion parsers (and, later, by importers of other apps' data), so
 * every field is validated rather than trusted, and anything unusable becomes `null` or an
 * empty list instead of throwing in the middle of a search.
 */

const EMPTY_BLOCK_IDS: readonly string[] = Object.freeze([])

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function stringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return EMPTY_BLOCK_IDS
  const ids = value.filter(
    (entry): entry is string => typeof entry === 'string' && entry.length > 0,
  )
  return ids.length === 0 ? EMPTY_BLOCK_IDS : ids
}

/** The empty locator: what a chunk with no `locator` column resolves to. */
export function emptySourceLocator(unitId: string | null = null): SourceLocator {
  return {
    unitId,
    page: null,
    tStartMs: null,
    tEndMs: null,
    label: null,
    selector: null,
    blockIds: EMPTY_BLOCK_IDS,
  }
}

/**
 * `chunk.unitId` plus whatever `chunk.locator` holds. `timestamp` is accepted as a legacy
 * alias of `t_start` (it is the key `docs/spec/07a-schema.md` uses for knowledge items).
 */
export function parseSourceLocator(chunk: Pick<Chunk, 'unitId' | 'locator'>): SourceLocator {
  const locator: JsonObject | null = chunk.locator
  if (locator === null) return emptySourceLocator(chunk.unitId)

  return {
    unitId: chunk.unitId,
    page: finiteNumber(locator.page),
    tStartMs: finiteNumber(locator.t_start) ?? finiteNumber(locator.timestamp),
    tEndMs: finiteNumber(locator.t_end),
    label: nonEmptyString(locator.label),
    selector: nonEmptyString(locator.selector),
    blockIds: stringList(locator.block_ids),
  }
}
