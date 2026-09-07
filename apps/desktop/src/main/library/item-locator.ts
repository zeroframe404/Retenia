import type { JsonObject, SourceLocator } from '@retenia/core'

/**
 * A knowledge item's `locator` JSON, from the chunk it was made from — the provenance that
 * makes the card citable. Every `SourceLocator` field survives here: `selector` and `tEndMs`
 * included, not only `page`/`label`/`tStartMs` — a card from a web or EPUB chunk has no
 * `page`/`tStartMs` at all and only `selector` to scroll to, and a clip's `tEndMs` is the
 * other half of the range `tStartMs` alone does not close. Pulled out of `createCardFromChunk`
 * so this mapping is unit-testable without the rest of `LibraryService`'s repository harness.
 */
export function buildItemLocatorFromChunk(chunkId: string, locator: SourceLocator): JsonObject {
  return {
    chunkId,
    ...(locator.page === null ? {} : { page: locator.page }),
    ...(locator.label === null ? {} : { label: locator.label }),
    ...(locator.tStartMs === null ? {} : { tStartMs: locator.tStartMs }),
    ...(locator.tEndMs === null ? {} : { tEndMs: locator.tEndMs }),
    ...(locator.selector === null ? {} : { selector: locator.selector }),
    blockIds: [...locator.blockIds],
  }
}
