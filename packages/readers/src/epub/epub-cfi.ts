import type { EPUB, EpubResolvedCfi } from './vendor/foliate-js/epub.js'
import * as CFI from './vendor/foliate-js/epubcfi.js'

/**
 * The CFI half of "highlight → item, and back": a highlight's anchor is a full-document
 * `epubcfi(...)` string, computed from the user's selection `Range` and restored to a `Range`
 * in the re-rendered section on the next open — across a restart, since it is what
 * `annotations.anchor` persists (`packages/db/src/schema/library.ts`).
 *
 * Thin on purpose: `vendor/foliate-js/epubcfi.js` already does the hard part (walking the DOM
 * to build/resolve the step list); this file only joins a section's CFI prefix with a
 * within-section range and re-exposes `EPUB.resolveCFI` under a name that says what it is
 * for.
 */

/**
 * A highlighted `Range` inside one section's rendered document → the full-document CFI to
 * persist. `sectionCfi` is `book.sections[index].cfi` — the section's own CFI prefix, which
 * `EPUB.init()` already resolved from the spine.
 */
export function computeAnnotationCfi(sectionCfi: string, range: Range): string {
  return CFI.joinIndir(sectionCfi, CFI.fromRange(range))
}

export interface ResolvedAnnotationCfi {
  /** Index into `book.sections` — which section to render before resolving the range. */
  sectionIndex: number
  /** Resolves to a `Range` in `doc`, which must be the `Document` rendered from that section. */
  resolveRange: (doc: Document) => Range
}

/** A persisted CFI → which section it names and how to resolve it once that section's
 *  document is rendered. `null` when the CFI names no section `book` has (a highlight made in
 *  a different edition/printing of the same title, or plain data corruption). */
export function resolveAnnotationCfi(book: EPUB, cfi: string): ResolvedAnnotationCfi | null {
  const resolved: EpubResolvedCfi = book.resolveCFI(cfi)
  if (resolved.index < 0) return null
  return { sectionIndex: resolved.index, resolveRange: resolved.anchor }
}

/** Sorts CFIs in document order — highlights within one section, listed top to bottom. */
export function compareCfi(a: string, b: string): number {
  return CFI.compare(a, b)
}
