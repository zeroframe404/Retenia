import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
  TextLayer,
} from 'pdfjs-dist/legacy/build/pdf.mjs'
// Vite's `?url` suffix resolves to the built worker script's own URL rather than inlining it,
// which is what lets a same-origin `new Worker(...)` load from `app://` under the renderer's
// strict CSP (`script-src 'self' 'wasm-unsafe-eval'` — no remote script sources,
// `docs/spec/07-architecture.md` §4). `pdfjs-dist`'s "legacy" build is used rather than the
// plain one for the same reason `packages/ingest`'s Node-side text extraction already does
// (`packages/ingest/src/parsers/pdf.ts`): one build that behaves identically whether the
// worker can actually spawn (a real Electron renderer) or not (this package's own jsdom
// tests, which have no `Worker` global and fall back to running pdf.js on the main thread).
import pdfWorkerSrc from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url'

export type { PageViewport } from 'pdfjs-dist/legacy/build/pdf.mjs'
export type { PDFDocumentProxy, PDFPageProxy }
export { TextLayer }

if (GlobalWorkerOptions.workerSrc === '') {
  GlobalWorkerOptions.workerSrc = pdfWorkerSrc
}

/**
 * Loads a PDF document from a `media://blob/<sha256>.pdf` URL (Range-served by
 * `apps/desktop/src/main/protocol/media-protocol.ts`, same as the video player's `src`) —
 * pdf.js requests only the byte ranges it needs rather than the whole file up front, which is
 * the "with Range support" half of the reader spec.
 *
 * No `standardFontDataUrl`/`cMapUrl` yet: a page whose fonts are not embedded (rare in a
 * scanned or exported book, common in nothing this reader's fixtures exercise) falls back to
 * pdf.js's built-in substitutes and logs a `standardFontDataUrl` warning rather than failing —
 * text extraction and selection are unaffected either way, only the substituted glyph shapes
 * on the canvas. Bundling `pdfjs-dist/standard_fonts` and `.../cmaps` as static assets is real,
 * scoped work (Vite has no built-in "copy this whole directory" primitive) worth doing once a
 * source that actually needs them shows up.
 */
export function loadPdfDocument(url: string): Promise<PDFDocumentProxy> {
  return getDocument({ url }).promise
}

/** A page's viewport at `scale`, in CSS pixels — the size to draw its canvas and text layer
 *  at, and the divisor that turns a `FractionalRect` (0–1) back into pixels or vice versa. */
export function pageViewport(page: PDFPageProxy, scale: number) {
  return page.getViewport({ scale })
}
