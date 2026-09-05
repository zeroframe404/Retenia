import type { OcrProvider, SourceKind } from '@retenia/core'
import type { ParseContext } from './parse-context'
import type { ParseInput } from './parse-input'
import { parseDocx } from './parsers/docx'
import { parseEpub } from './parsers/epub'
import { parseImage } from './parsers/image'
import { parseMarkdown } from './parsers/markdown'
import { parsePdf } from './parsers/pdf'
import { parsePptx } from './parsers/pptx'
import type { SourceDoc } from './source-doc'

/**
 * The one entry point the ingestion job (`apps/desktop/src/jobs/ingest-parse.ts`) calls:
 * picks the right parser for a source's `kind` and hands back its `SourceDoc`.
 *
 * Audio, video, YouTube and web sources have no parser yet — those land in later sub-phases
 * (6.4, 6.5) — so this throws a clear, specific error for them rather than silently
 * returning an empty document.
 */
export async function parseDocument(
  kind: SourceKind,
  input: ParseInput,
  ctx: ParseContext,
  ocr: OcrProvider,
): Promise<SourceDoc> {
  switch (kind) {
    case 'pdf':
      return parsePdf(input, ctx)
    case 'docx':
      return parseDocx(input, ctx)
    case 'epub':
      return parseEpub(input, ctx)
    case 'pptx':
      return parsePptx(input, ctx)
    case 'markdown':
      return parseMarkdown(input, ctx, { frontmatter: true })
    case 'text':
      return parseMarkdown(input, ctx, { frontmatter: false })
    case 'image':
      return parseImage(input, ctx, ocr)
    case 'audio':
    case 'video':
    case 'youtube':
    case 'web':
      throw new Error(`No parser is implemented yet for source kind "${kind}"`)
  }
}
