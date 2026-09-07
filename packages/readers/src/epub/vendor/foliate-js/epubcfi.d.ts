/**
 * Types for `epubcfi.js` (see `README.md` in this directory) — the surface
 * `packages/readers/src/epub` actually calls, not a full re-typing of the module. A `.d.ts`
 * beside a same-named `.js` is what TypeScript resolves an `import … from './epubcfi.js'`
 * against; this file is ours, not part of the vendored source.
 */

/** Opaque parsed-CFI shape (a step list, or `{ parent, start, end }` for a range CFI). Never
 *  inspected directly outside this module — only round-tripped through `toRange`/`collapse`/
 *  `compare`. */
export type ParsedCfi = unknown

export function parse(cfi: string): ParsedCfi

/** Joins a section-level CFI prefix with a within-section CFI fragment (`epubcfi(a)`,
 *  `epubcfi(b)` → `epubcfi(a!b)`). Both inputs and the result are `epubcfi(...)`-wrapped
 *  strings. */
export function joinIndir(...parts: string[]): string

/** A DOM `Range` (collapsed or not) → a local CFI string, relative to `range`'s own document.
 *  `filter`, when given, skips nodes it flags `NodeFilter.FILTER_SKIP` for. */
export function fromRange(range: Range, filter?: (node: Node) => number): string

/** The inverse of `fromRange`/`resolveCFI`'s `anchor`: a parsed CFI (or a CFI string) → a
 *  `Range` in `doc`. */
export function toRange(doc: Document, parts: ParsedCfi, filter?: (node: Node) => number): Range

export function compare(a: string | ParsedCfi, b: string | ParsedCfi): number

export function collapse(x: string | ParsedCfi, toEnd?: boolean): string | ParsedCfi
