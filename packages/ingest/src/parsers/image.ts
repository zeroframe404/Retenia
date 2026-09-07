import type { OcrProvider } from '@retenia/core'
import { detectLanguage } from '../detect-language'
import { sha256Hex } from '../hash'
import type { ParseContext } from '../parse-context'
import type { ParseInput } from '../parse-input'
import type { SourceDoc } from '../source-doc'

/**
 * A standalone image source (`docs/spec/05-ingestion-rag.md` §1: "Images with text →
 * Tesseract.js (printed) with confidence"). The image's own bytes are already the source's
 * blob (set when the Library imported it), so this parser adds no `Asset` of its own — only
 * the text `recognize` found.
 *
 * `needsOcr` doubles as the "low confidence or handwriting" flag the task calls for: this
 * pass has no separate handwriting classifier, so a low score is the one signal for both —
 * a human (or a future cloud OCR provider) should take a second look either way.
 */
export const OCR_CONFIDENCE_THRESHOLD = 60

export async function parseImage(
  input: ParseInput,
  ctx: ParseContext,
  ocr: OcrProvider,
): Promise<SourceDoc> {
  const { text, confidence } = await ocr.recognize(input.bytes)
  const trimmed = text.trim()

  const block = {
    id: ctx.id(),
    type: 'paragraph' as const,
    text: trimmed,
    // A standalone image is trivially a one-page document — `page: 1` is the least this can
    // say and still be a locator a citation can point at, rather than `{}`, which pointed at
    // nothing. Registered in `chunk-source-doc.ts`'s `PAGED_KINDS` so the chunker actually
    // carries it through (a block-level `page` on a `kind` absent from that map is silently
    // never read).
    locator: { page: 1 },
    hash: sha256Hex(trimmed),
  }
  const section = {
    id: ctx.id(),
    title: input.fallbackTitle,
    level: 0,
    blocks: [block.id],
    children: [],
  }

  return {
    id: ctx.id(),
    kind: 'image',
    title: input.fallbackTitle,
    language: trimmed.length > 0 ? detectLanguage(trimmed) : null,
    sections: [section],
    blocks: [block],
    assets: [],
    meta: {
      ocrConfidence: confidence,
      needsOcr: confidence < OCR_CONFIDENCE_THRESHOLD,
      warnings: [],
    },
  }
}
