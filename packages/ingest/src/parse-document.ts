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
 * Audio and video have no case here (sub-phase 6.4): they need a sidecar toolchain
 * (ffmpeg/whisper) that only exists inside the job's own environment, so
 * `apps/desktop/src/jobs/ingest-media.ts` calls `@retenia/ingest/media`'s `parseMedia`
 * directly and never reaches this function. Web and YouTube (sub-phase 6.5) need no such
 * split — main fetches the page/transcript *before* enqueueing and stores the result as the
 * source's blob (`packages/ingest/src/web/types.ts`'s envelopes), so `input.bytes` here is
 * already exactly what every other kind's bytes are: something to parse, not something to
 * fetch — and they take this same generic path.
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
    case 'web': {
      const { parseWebPage } = await import('./web/parse-web')
      return parseWebPage(input, ctx)
    }
    case 'youtube': {
      const { parseYouTubePage } = await import('./web/parse-youtube')
      return parseYouTubePage(input, ctx)
    }
    case 'audio':
    case 'video':
      throw new Error(`"${kind}" is parsed by ingest-media.ts, not parseDocument`)
  }
}
