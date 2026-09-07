import { Readability } from '@mozilla/readability'
import { Defuddle } from 'defuddle/node'
import { JSDOM } from 'jsdom'
import { parse as parseHtml } from 'node-html-parser'

/**
 * Pulling the article out of a fetched page (`docs/spec/05-ingestion-rag.md` §1: "Defuddle …
 * or Readability + JSDOM → Markdown with Turndown").
 *
 * Defuddle runs first — it is more forgiving than Readability and normalizes footnotes, math
 * and code blocks on the way out, which is exactly the shape `html-to-markdown.ts` is written
 * against. Readability is the fallback for the pages Defuddle cannot make sense of, and the raw
 * `<body>` is the last resort: a page that fools both extractors still becomes *something*
 * citable rather than a failed import (the same philosophy as an audio source with no speech
 * still producing a document with a warning, sub-phase 6.4).
 */

/** Below this many words, an "extraction" is presumed to be a nav bar or a paywall stub rather
 *  than the article — small enough that a genuinely short post still survives. */
const MIN_WORDS_FOR_A_REAL_EXTRACTION = 40

export interface ExtractedArticle {
  title: string | null
  /** Clean HTML — never the whole page, never `null` (an empty string is a legitimate "found
   *  nothing" result the caller can warn about, not an exceptional one). */
  html: string
  author: string | null
  /** BCP-47 when the extractor (or the page's own `lang`/`html[lang]`) reported one. */
  language: string | null
  extractor: 'defuddle' | 'readability' | 'raw'
  /** The page's own `<link rel="canonical">`, resolved to an absolute URL, when it names one —
   *  independent of which extractor found the article, since a canonical tag lives in `<head>`
   *  and none of the three extraction branches look there. `parse-web.ts` prefers this over the
   *  fetched URL for `meta.origin.url`: the same article reached via `?utm_source=…`, an AMP
   *  mirror, or a share link otherwise cites and re-fetches under a different URL each time. */
  canonicalUrl: string | null
  warnings: string[]
}

function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length
}

/** Strips tags to plain text, only to decide whether an extraction is substantial — never used
 *  as the extracted content itself. */
function toPlainText(html: string): string {
  return html.replace(/<[^>]*>/g, ' ')
}

async function tryDefuddle(
  html: string,
  url: string,
): Promise<Omit<ExtractedArticle, 'warnings' | 'extractor' | 'canonicalUrl'> | undefined> {
  try {
    const result = await Defuddle(html, url, {
      // Defuddle's own extractors (YouTube, Reddit, GitHub…) reach out to third-party APIs by
      // default; this is a plain article fetch and nothing here should make a network call
      // this module did not decide to make itself.
      useAsync: false,
      // Our own image fetcher (`parse-web.ts`) decides same-origin/tracker questions; letting
      // Defuddle silently drop "small" images first would make that logic untestable.
      removeSmallImages: false,
    })
    const words = result.wordCount > 0 ? result.wordCount : countWords(toPlainText(result.content))
    if (result.content.trim().length === 0 || words < MIN_WORDS_FOR_A_REAL_EXTRACTION) {
      return undefined
    }
    return {
      title: result.title.trim().length > 0 ? result.title : null,
      html: result.content,
      author: result.author.trim().length > 0 ? result.author : null,
      language: result.language.trim().length > 0 ? result.language : null,
    }
  } catch {
    return undefined
  }
}

function tryReadability(
  html: string,
  url: string,
): Omit<ExtractedArticle, 'warnings' | 'extractor' | 'canonicalUrl'> | undefined {
  let dom: JSDOM
  try {
    dom = new JSDOM(html, { url })
  } catch {
    return undefined
  }
  const article = new Readability(dom.window.document).parse()
  const content = article?.content
  if (content == null || countWords(toPlainText(content)) < MIN_WORDS_FOR_A_REAL_EXTRACTION) {
    return undefined
  }
  return {
    title: article?.title?.trim() || null,
    html: content,
    author: article?.byline?.trim() || null,
    language: article?.lang?.trim() || null,
  }
}

/** The whole `<body>`, when neither extractor could find an article — better than an empty
 *  document, worse than either extractor, hence only ever tried last. */
function rawBody(
  html: string,
  url: string,
): Omit<ExtractedArticle, 'warnings' | 'extractor' | 'canonicalUrl'> {
  try {
    const dom = new JSDOM(html, { url })
    return {
      title: dom.window.document.title.trim() || null,
      html: dom.window.document.body?.innerHTML ?? '',
      author: null,
      language: dom.window.document.documentElement.lang.trim() || null,
    }
  } catch {
    return { title: null, html: '', author: null, language: null }
  }
}

/** The page's `<link rel="canonical">`, if it has one — lives in `<head>`, so independent of
 *  whichever extractor below finds the article body. Read with `node-html-parser` (already a
 *  dependency, via `parsers/epub.ts`/`parsers/docx.ts`) rather than `JSDOM`: this runs
 *  unconditionally on every call, including the common `defuddle` success path that otherwise
 *  builds no DOM at all, and a second full `jsdom` parse there was measured to roughly double
 *  this function's cost — cheap enough locally to go unnoticed, but enough to tip a real-fixture
 *  test over Vitest's default timeout on a loaded Windows CI runner. */
function readCanonicalUrl(html: string, url: string): string | null {
  try {
    const href = parseHtml(html).querySelector('link[rel="canonical"]')?.getAttribute('href')
    if (href === undefined || href.trim().length === 0) return null
    return new URL(href, url).href
  } catch {
    return null
  }
}

/** Test seam: forces a branch without depending on either library's exact scoring internals —
 *  a fixture thin enough to make Defuddle *itself* give up is not necessarily thin enough to
 *  make Readability give up too, and hand-crafting one that reliably is would test the
 *  libraries' heuristics more than this module's fallback logic. */
export interface ExtractArticleDeps {
  tryDefuddle?: typeof tryDefuddle
  tryReadability?: typeof tryReadability
}

export async function extractArticle(
  html: string,
  url: string,
  deps: ExtractArticleDeps = {},
): Promise<ExtractedArticle> {
  const runDefuddle = deps.tryDefuddle ?? tryDefuddle
  const runReadability = deps.tryReadability ?? tryReadability
  const warnings: string[] = []
  const canonicalUrl = readCanonicalUrl(html, url)

  const defuddled = await runDefuddle(html, url)
  if (defuddled !== undefined) {
    return { ...defuddled, extractor: 'defuddle', canonicalUrl, warnings }
  }

  const read = runReadability(html, url)
  if (read !== undefined) {
    warnings.push('Defuddle could not extract this page; Readability was used instead')
    return { ...read, extractor: 'readability', canonicalUrl, warnings }
  }

  warnings.push(
    'Neither Defuddle nor Readability could identify the main content; the whole page was kept',
  )
  return { ...rawBody(html, url), extractor: 'raw', canonicalUrl, warnings }
}
