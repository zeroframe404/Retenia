import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFiumLibrary } from '@hyzyla/pdfium'
import type { OcrProvider } from '@retenia/core'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { detectLanguage } from '../detect-language'
import { sha256Hex } from '../hash'
import type { ParseContext } from '../parse-context'
import type { ParseInput } from '../parse-input'
import { encodeBgraAsPng } from '../png-encoder'
import { createSectionTree } from '../section-tree'
import type { Asset, Block, SourceDoc } from '../source-doc'
import { OCR_CONFIDENCE_THRESHOLD } from './image'

/**
 * PDF (`docs/spec/05-ingestion-rag.md` §1): `pdfjs-dist` for text, position and page count;
 * a page with `< 50` extractable characters is scanned, and every scanned page is rendered
 * to a PNG via `@hyzyla/pdfium` and run through `ocr` — the same local-Tesseract-by-default
 * port `parsers/image.ts` uses, not a placeholder for a later cloud job. `meta.ocrPages` and
 * `meta.needsOcr` are about what OCR could not resolve *confidently* (`OCR_CONFIDENCE_THRESHOLD`,
 * the same bar `image.ts` uses): a page OCR read with confidence is no longer "needs OCR",
 * it is done, and only a low-confidence or handwritten page still asks for a second look
 * (`docs/spec/06-ai-providers.md`'s opt-in cloud VLM is that second look, still to come in
 * sub-phase 7.x — this is the "OCR with a VLM" step §1's closing rule already calls for).
 *
 * Reading order is column-naive: lines are sorted top-to-bottom, left-to-right across the
 * full page width. A genuinely multi-column layout would interleave under this rule — no
 * fixture here exercises one, and column detection is real added complexity better done
 * when something actually needs it.
 */

const SCANNED_PAGE_CHAR_THRESHOLD = 50
/** A line taller than this multiple of the document's own median line height counts as a
 *  heading. Multiple distinct sizes above that get their own nesting level, largest first. */
const HEADING_SIZE_RATIO = 1.3
const MAX_HEADING_LEVELS = 3

interface TextItemLike {
  str: string
  transform: number[]
  width: number
  height: number
  hasEOL: boolean
}

/** A plain boolean predicate, not a type guard: pdfjs's own `TextItem | TextMarkedContent`
 *  union does not structurally extend `TextItemLike` (it carries fields this parser has no
 *  use for), which is exactly the mismatch that stops `Array.prototype.filter`'s narrowing
 *  overload from applying — the cast below is what actually narrows. */
function isTextItemLike(item: unknown): boolean {
  return (
    typeof item === 'object' &&
    item !== null &&
    typeof (item as { str?: unknown }).str === 'string' &&
    Array.isArray((item as { transform?: unknown }).transform)
  )
}

interface Line {
  y: number
  height: number
  text: string
  /** Left edge of the first item and right edge of the last, for a rough per-line bbox. */
  x0: number
  x1: number
}

/** Groups a page's text items into reading-order lines: cluster by y (items on the same
 *  baseline, within a small tolerance), then sort each line's items left-to-right. */
function groupIntoLines(items: TextItemLike[]): Line[] {
  const byY = new Map<number, TextItemLike[]>()
  for (const item of items) {
    if (item.str.trim().length === 0) continue
    const y = Math.round(item.transform[5] as number)
    // Snap to the nearest existing bucket within 2pt, so two items on the same visual line
    // that differ by rounding noise do not become two one-item lines.
    const key = [...byY.keys()].find((existing) => Math.abs(existing - y) <= 2) ?? y
    const bucket = byY.get(key)
    if (bucket) bucket.push(item)
    else byY.set(key, [item])
  }

  const lines: Line[] = []
  for (const [y, lineItems] of byY) {
    lineItems.sort((a, b) => (a.transform[4] as number) - (b.transform[4] as number))
    const text = lineItems
      .map((i) => i.str)
      .join('')
      .trim()
    if (text.length === 0) continue
    lines.push({
      y,
      height: Math.max(...lineItems.map((i) => i.height)),
      text,
      x0: Math.min(...lineItems.map((i) => i.transform[4] as number)),
      x1: Math.max(...lineItems.map((i) => (i.transform[4] as number) + i.width)),
    })
  }
  // PDF's coordinate origin is bottom-left, so a larger y is higher on the page.
  lines.sort((a, b) => b.y - a.y)
  return lines
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[mid] as number)
}

/** Heading font sizes across the document, largest first — used to assign a nesting level
 *  to a line by its size rather than a single flat "is a heading" bit. */
function headingLevels(allLineHeights: number[], baseline: number): number[] {
  const distinctSizes = [
    ...new Set(allLineHeights.filter((h) => h >= baseline * HEADING_SIZE_RATIO)),
  ]
  return distinctSizes.sort((a, b) => b - a).slice(0, MAX_HEADING_LEVELS)
}

interface PdfiumHandle {
  render(
    pageIndex: number,
    scale: number,
  ): Promise<{ data: Uint8Array; width: number; height: number }>
  close(): Promise<void>
}

async function openPdfium(bytes: Uint8Array): Promise<PdfiumHandle> {
  const library = await PDFiumLibrary.init()
  const document = await library.loadDocument(bytes)
  return {
    render: async (pageIndex, scale) => {
      const page = document.getPage(pageIndex)
      return page.render({ scale, render: async (options) => options.data })
    },
    close: async () => {
      document.destroy()
      library.destroy()
    },
  }
}

export async function parsePdf(
  input: ParseInput,
  ctx: ParseContext,
  ocr: OcrProvider,
): Promise<SourceDoc> {
  const standardFontDataUrl = `${join(
    dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json'))),
    'standard_fonts',
  )}/`

  // A genuine copy, not a view: `getDocument({ data })` takes ownership of and detaches the
  // buffer behind whatever `Uint8Array` it is given (per its own doc comment), and pdfium
  // reads the same bytes again later for any page flagged `needsOcr` — sharing one buffer
  // between the two would leave the second read looking at detached memory. This also
  // sidesteps pdfjs-dist's separate refusal to accept a `Buffer` (a `Uint8Array` subclass)
  // specifically, since the copy is a plain `Uint8Array` regardless of what `input.bytes` was.
  const data = new Uint8Array(input.bytes)

  const pdf = await getDocument({
    data,
    useWorkerFetch: false,
    standardFontDataUrl,
  }).promise

  const pages: Array<{ pageNumber: number; lines: Line[]; charCount: number }> = []
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    const items = content.items.filter(isTextItemLike) as unknown as TextItemLike[]
    const lines = groupIntoLines(items)
    const charCount = lines.reduce((sum, line) => sum + line.text.length, 0)
    pages.push({ pageNumber, lines, charCount })
  }

  const baseline = median(pages.flatMap((p) => p.lines.map((l) => l.height)))
  const levels = headingLevels(
    pages.flatMap((p) => p.lines.map((l) => l.height)),
    baseline,
  )
  const hasScannedPages = pages.some((p) => p.charCount < SCANNED_PAGE_CHAR_THRESHOLD)

  const blocks: Block[] = []
  const assets: Asset[] = []
  const tree = createSectionTree(() => ctx.id(), input.fallbackTitle)
  const lowConfidencePages: number[] = []
  let title: string | undefined

  // Opened once, up front, so a scanned page's render+OCR can happen inline within the loop
  // below, in document order — `tree.attach()` always pushes to whatever section is
  // currently open, so a page's OCR block must attach at the moment its page is reached, not
  // in a trailing pass after the whole tree has already been built.
  const pdfium = hasScannedPages ? await openPdfium(new Uint8Array(input.bytes)) : undefined

  try {
    for (const { pageNumber, lines, charCount } of pages) {
      let paragraph: Line[] = []
      const flushParagraph = (): void => {
        if (paragraph.length === 0) return
        const text = paragraph.map((l) => l.text).join(' ')
        const first = paragraph[0] as Line
        const last = paragraph[paragraph.length - 1] as Line
        const block: Block = {
          id: ctx.id(),
          type: 'paragraph',
          text,
          locator: {
            page: pageNumber,
            bbox: [
              Math.min(first.x0, last.x0),
              last.y,
              Math.max(first.x1, last.x1) - Math.min(first.x0, last.x0),
              first.y - last.y + first.height,
            ],
          },
          hash: sha256Hex(text),
        }
        blocks.push(block)
        tree.attach(block.id)
        paragraph = []
      }

      let previousLine: Line | undefined
      for (const line of lines) {
        const level = levels.findIndex((size) => Math.abs(size - line.height) < 0.5)
        if (level !== -1) {
          flushParagraph()
          tree.pushHeading(ctx.id(), line.text, level + 1)
          if (title === undefined && level === 0) title = line.text
          previousLine = line
          continue
        }

        // A gap noticeably bigger than the line's own height reads as a paragraph break.
        const gap = previousLine ? previousLine.y - line.y : 0
        if (previousLine && gap > line.height * 1.8) flushParagraph()
        paragraph.push(line)
        previousLine = line
      }
      flushParagraph()

      if (charCount < SCANNED_PAGE_CHAR_THRESHOLD && pdfium) {
        const rendered = await pdfium.render(pageNumber - 1, 1.5)
        const png = encodeBgraAsPng(rendered.data, rendered.width, rendered.height)
        const asset = await ctx.putAsset(png, 'image/png', 'thumbnail')
        asset.locator = { page: pageNumber }
        assets.push(asset)

        const { text, confidence } = await ocr.recognize(png)
        if (confidence < OCR_CONFIDENCE_THRESHOLD) lowConfidencePages.push(pageNumber)

        // Unlike a standalone image source (whose one block is the whole document, always
        // present even when empty), a blank scanned page contributes nothing to chunk — same
        // rule `flushParagraph` already applies to a page with no text at all.
        const trimmed = text.trim()
        if (trimmed.length > 0) {
          const block: Block = {
            id: ctx.id(),
            type: 'paragraph',
            text: trimmed,
            locator: { page: pageNumber },
            hash: sha256Hex(trimmed),
          }
          blocks.push(block)
          tree.attach(block.id)
        }
      }
    }
  } finally {
    await pdfium?.close()
  }

  const language = detectLanguage(blocks.map((b) => b.text).join('\n'))

  return {
    id: ctx.id(),
    kind: 'pdf',
    title: title ?? input.fallbackTitle,
    language,
    sections: tree.roots,
    blocks,
    assets,
    meta: {
      pageCount: pdf.numPages,
      needsOcr: lowConfidencePages.length > 0,
      ...(lowConfidencePages.length > 0 ? { ocrPages: lowConfidencePages } : {}),
      warnings: [],
    },
  }
}
