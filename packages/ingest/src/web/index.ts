/**
 * The web and YouTube importers (sub-phase 6.5, `docs/spec/05-ingestion-rag.md` §1's "Web" and
 * "YouTube" rows).
 *
 * A separate entry point (`@retenia/ingest/web`) rather than part of the package barrel, for
 * the same reason `/media` is one: `jsdom`, `defuddle` and `@mozilla/readability` are real
 * weight, and `apps/desktop/src/jobs/ingest-parse.ts` — which imports the barrel for its job
 * registry — should not evaluate an HTML engine at startup just to read a type.
 */

export { type ExtractArticleDeps, type ExtractedArticle, extractArticle } from './extract-article'
export { createHtmlToMarkdown, htmlToMarkdown } from './html-to-markdown'
export {
  createDefaultImageFetcher,
  type ParseWebPageDeps,
  parseWebPage,
} from './parse-web'
export {
  type ParseYouTubePageDeps,
  parseYouTubePage,
} from './parse-youtube'
export type {
  WebImageFetcher,
  WebPageEnvelope,
  YouTubeEnvelope,
  YouTubeTranscriptCue,
} from './types'
export {
  normalizeYouTubeTranscript,
  type RawTranscriptCue,
} from './youtube-transcript-normalize'
export {
  canonicalWatchUrl,
  parseYouTubeUrl,
  type YouTubeUrlKind,
} from './youtube-url'
