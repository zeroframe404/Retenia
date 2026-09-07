/**
 * Types for `epub.js` (see `README.md` in this directory) — the surface
 * `packages/readers/src/epub` actually calls, not a full re-typing of the module. A `.d.ts`
 * beside a same-named `.js` is what TypeScript resolves an `import … from './epub.js'`
 * against; this file is ours, not part of the vendored source.
 */

export interface EpubLoader {
  loadText(href: string): Promise<string | null>
  loadBlob(href: string): Promise<Blob | ArrayBuffer | null>
  getSize(href: string): number
  /** Only needed for Adobe/obfuscated-font deobfuscation; absent when the caller has no
   *  identifier to derive it from. */
  sha1?: (data: Uint8Array) => string
}

export interface EpubTocItem {
  label: string
  href: string
  subitems?: EpubTocItem[]
}

export interface EpubSection {
  /** The manifest item's href, resolved against the OPF — the section's stable id. */
  id: string
  load(): Promise<string>
  unload(): void
  createDocument(): Promise<XMLDocument>
  /** The section-level CFI prefix (`epubcfi(/6/<n>!)`) — `joinIndir` with a within-section CFI
   *  builds the full document CFI for a highlight anchored in this section. */
  cfi: string
  linear: string | undefined
  resolveHref(href: string): string
}

export interface EpubResolvedCfi {
  /** Index into `EPUB.sections`, or `-1` if the CFI names no known spine item. */
  index: number
  /** `doc` must be the `Document` rendered from `sections[index]` — resolves to a `Range` in
   *  it via the vendored `epubcfi.js`'s `toRange`. */
  anchor(doc: Document): Range
}

export interface EpubMetadata {
  title?: unknown
  author?: unknown
  [key: string]: unknown
}

export class EPUB {
  constructor(loader: EpubLoader)
  init(): Promise<this>
  sections: EpubSection[]
  toc: EpubTocItem[] | undefined
  metadata: EpubMetadata
  dir: 'rtl' | 'ltr' | undefined
  resolveCFI(cfi: string): EpubResolvedCfi
  resolveHref(href: string): { index: number; anchor: (doc: Document) => number | Element } | null
  destroy(): void
}
