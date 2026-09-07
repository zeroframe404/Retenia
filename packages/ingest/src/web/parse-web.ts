import { JSDOM } from 'jsdom'
import { detectLanguage } from '../detect-language'
import { sha256Hex } from '../hash'
import type { ParseContext } from '../parse-context'
import type { ParseInput } from '../parse-input'
import { createSectionTree } from '../section-tree'
import type { Asset, Block, BlockType, SourceDoc } from '../source-doc'
import { extractArticle } from './extract-article'
import { createHtmlToMarkdown, htmlToMarkdown } from './html-to-markdown'
import type { WebImageFetcher, WebPageEnvelope } from './types'

/**
 * The web importer's own parser (sub-phase 6.5, `docs/spec/05-ingestion-rag.md` §1's "Web"
 * row): article extraction → clean HTML walked block by block → `SourceDoc` sectioned by
 * H2/H3 (6.2's chunker already does the H2/H3 boundary; this only has to produce accurate
 * `Section.level`s and a `Block` per element, exactly as `epub.ts` and `docx.ts` do for their
 * own formats).
 *
 * `input.bytes` is not the page itself — it is a `WebPageEnvelope`, JSON-encoded, that main
 * wrote after fetching (and, when needed, SPA-rendering) the page. That indirection is what
 * lets this parser stay on the exact same job path every other kind already uses: no Electron
 * import here, ever, and no change needed to the job's input schema.
 */

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const IMAGE_FETCH_TIMEOUT_MS = 10_000
/** Per-document caps on top of the per-image size cap above: `createDefaultImageFetcher` bounds
 *  any *one* image, but nothing bounded how many `<img>` tags a single page's walk could fetch —
 *  a page with thousands of same-origin images (real or manufactured) had no ceiling on total
 *  requests or total bytes written to the blob store (`security-reviewer` finding M3). */
const MAX_IMAGES_PER_DOCUMENT = 200
const MAX_TOTAL_IMAGE_BYTES = 50 * 1024 * 1024

/** Minimal HTML-attribute escaping for the handful of values this module interpolates into a
 *  `Block.html` string by hand (`pushFigure`'s `<img>` tag) rather than through `el.outerHTML` —
 *  `alt` text and a `src` URL are both attacker-controlled when the page is. Nothing in this
 *  codebase renders `Block.html` unsanitized today (`security-reviewer` verified no
 *  `dangerouslySetInnerHTML` sink reads it), but the value is stored and will eventually be
 *  rendered by something, so it is escaped at the source rather than left as a landmine
 *  (`security-reviewer` finding L5). */
function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Hostname fragments that are never worth a request regardless of origin — the "skip
 *  trackers" half of the spec line, kept short and named rather than exhaustive: a same-origin
 *  analytics pixel is rare, and the same-origin check below already stops the common case
 *  (a third-party ad/analytics domain). */
const TRACKER_HOST_FRAGMENTS = [
  'doubleclick.net',
  'google-analytics.com',
  'googletagmanager.com',
  'googlesyndication.com',
  'facebook.com/tr',
  'scorecardresearch.com',
  'adservice.',
  'analytics.',
]

function looksLikeTracker(url: URL, widthAttr: string | null, heightAttr: string | null): boolean {
  if (widthAttr === '1' && heightAttr === '1') return true
  const host = url.host.toLowerCase()
  return TRACKER_HOST_FRAGMENTS.some((fragment) => host.includes(fragment))
}

function mimeFromContentType(contentType: string | null): string {
  return (
    (contentType ?? 'application/octet-stream').split(';')[0]?.trim() || 'application/octet-stream'
  )
}

/**
 * The default `WebImageFetcher`: same-origin only, a short tracker blocklist, a size cap, and a
 * short timeout — a broken or hostile image link degrades to "no figure for this image", never
 * to a failed import. `fetchImpl` is a seam for tests, `globalThis.fetch` otherwise; this is
 * plain Node fetch rather than Electron's `net.fetch` deliberately — it runs inside the job's
 * `utilityProcess`, which has no `BrowserWindow` and no reason to route through Chromium's
 * network stack for a handful of already-known image URLs.
 */
export function createDefaultImageFetcher(
  pageUrl: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): WebImageFetcher {
  const origin = new URL(pageUrl).origin

  return async (imageUrl) => {
    let url: URL
    try {
      url = new URL(imageUrl)
    } catch {
      return null
    }
    if (url.origin !== origin) return null

    try {
      // `redirect: 'manual'` rather than the default `'follow'`: a same-origin URL that 302s
      // elsewhere would otherwise be fetched wherever it redirects to — including off-origin, or
      // to a private/internal address — with nothing here ever re-checking the target, since the
      // origin check above only ever saw the *original* URL (`security-reviewer` finding
      // "New-3"). A redirecting image is unusual enough that simply refusing to follow it (same
      // as `!response.ok` already treats any other failure) costs nothing real.
      const response = await fetchImpl(url.href, {
        signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
        redirect: 'manual',
      })
      if (!response.ok || response.body === null) return null
      const contentLength = response.headers.get('content-length')
      if (contentLength !== null && Number(contentLength) > MAX_IMAGE_BYTES) return null

      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let total = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > MAX_IMAGE_BYTES) {
          await reader.cancel()
          return null
        }
        chunks.push(value)
      }

      const bytes = new Uint8Array(total)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      return { bytes, mime: mimeFromContentType(response.headers.get('content-type')) }
    } catch {
      return null
    }
  }
}

/** Tags whose content is never the article — the raw `<body>` fallback (never stripped by an
 *  extractor) needs this; Defuddle/Readability output rarely does, but costs nothing to skip
 *  again. */
const SKIP_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'nav',
  'header',
  'footer',
  'aside',
  'form',
  'button',
  'svg',
  'iframe',
])

const HEADING_LEVEL = /^h([1-6])$/i

function isElement(node: Node): node is Element {
  return node.nodeType === 1
}

/**
 * Un-wraps a single container element Defuddle/Readability leave around the real content
 * (`<article>`, a Readability `<div id="readability-page-1">`…) so the walk below sees the
 * article's actual paragraphs and headings as its direct children — exactly the shape
 * `epub.ts`'s `body > *` walk assumes for an EPUB chapter. Bounded rather than recursive: three
 * levels covers every wrapper this module has actually seen, and an unbounded unwrap would risk
 * descending into the article's own first `<div>` of real content.
 */
function contentRoot(body: Element): Element {
  let node = body
  for (let depth = 0; depth < 3; depth += 1) {
    const children = [...node.children]
    const only = children.length === 1 ? children[0] : undefined
    if (only === undefined) break
    if (!['article', 'div', 'section', 'main'].includes(only.tagName.toLowerCase())) break
    node = only
  }
  return node
}

function tableText(el: Element): string {
  return [...el.querySelectorAll('tr')]
    .map((row) =>
      [...row.querySelectorAll('td, th')]
        .map((cell) => (cell.textContent ?? '').trim())
        .join(' | '),
    )
    .join('\n')
}

function listText(el: Element): string {
  return [...el.querySelectorAll('li')].map((li) => (li.textContent ?? '').trim()).join('\n')
}

function blockTypeForTag(tag: string): BlockType | undefined {
  if (HEADING_LEVEL.test(tag)) return 'heading'
  switch (tag) {
    case 'p':
    case 'blockquote':
    case 'div':
      return 'paragraph'
    case 'ul':
    case 'ol':
      return 'list'
    case 'table':
      return 'table'
    case 'pre':
      return 'code'
    case 'img':
    case 'figure':
      return 'figure'
    // Defuddle's standardized shorthand for a *display* formula is a bare top-level
    // `<math data-latex="…" display="block">` — no wrapping element survives to carry a
    // "paragraph" tag, so this needs its own case rather than falling through to one.
    case 'math':
      return 'equation'
    default:
      return undefined
  }
}

/** The one `<img>` a figure paragraph is standing in for, when the element carries no other
 *  text of its own — the same "a paragraph that is only an image" convention `epub.ts` and
 *  `markdown.ts` use, generalized to a bare top-level `<img>`/`<figure>` too. */
function soleImage(el: Element): HTMLImageElement | undefined {
  if (el.tagName.toLowerCase() === 'img') return el as HTMLImageElement
  const images = el.querySelectorAll('img')
  if (images.length !== 1) return undefined
  return (el.textContent ?? '').trim().length === 0 ? (images[0] as HTMLImageElement) : undefined
}

interface WalkContext {
  ctx: ParseContext
  turndown: ReturnType<typeof createHtmlToMarkdown>
  fetchImage: WebImageFetcher
  pageUrl: string
  blocks: Block[]
  assets: Asset[]
  tree: ReturnType<typeof createSectionTree>
  elementIndex: number
  imagesFetched: number
  imageBytesFetched: number
  imageCapHit: boolean
}

function nextAnchor(wc: WalkContext, el: Element): string {
  const id = el.getAttribute('id')
  const anchor = id && id.trim().length > 0 ? `#${id.trim()}` : `el-${wc.elementIndex}`
  wc.elementIndex += 1
  return anchor
}

function resolveUrl(pageUrl: string, href: string): string | undefined {
  try {
    return new URL(href, pageUrl).href
  } catch {
    return undefined
  }
}

async function pushFigure(wc: WalkContext, img: HTMLImageElement, anchor: string): Promise<void> {
  const alt = (img.getAttribute('alt') ?? '').trim()
  const src = img.getAttribute('src')
  const absolute = src ? resolveUrl(wc.pageUrl, src) : undefined

  let asset: Asset | undefined
  if (absolute !== undefined) {
    const url = (() => {
      try {
        return new URL(absolute)
      } catch {
        return undefined
      }
    })()
    const skip =
      url !== undefined &&
      looksLikeTracker(url, img.getAttribute('width'), img.getAttribute('height'))
    const overCap =
      wc.imagesFetched >= MAX_IMAGES_PER_DOCUMENT || wc.imageBytesFetched >= MAX_TOTAL_IMAGE_BYTES
    if (overCap) wc.imageCapHit = true

    if (!skip && !overCap) {
      // Counted here, before the request, not after a successful one: a page with thousands of
      // same-origin `<img>` tags pointing at 404s or slow endpoints would otherwise issue
      // unbounded *requests* even though it never produces enough successes to trip the cap
      // (`security-reviewer` finding "New-4") — each failed attempt still costs up to
      // `IMAGE_FETCH_TIMEOUT_MS`, so request count needs its own ceiling independent of outcome.
      wc.imagesFetched += 1
      const fetched = await wc.fetchImage(absolute)
      if (fetched !== null) {
        wc.imageBytesFetched += fetched.bytes.byteLength
        asset = await wc.ctx.putAsset(fetched.bytes, fetched.mime, 'image')
        wc.assets.push(asset)
      }
    }
  }

  // Nothing to cite: no downloaded asset and no alt text describing it (a tracking pixel,
  // typically) — a block with neither would be noise no chunk or citation could use.
  if (asset === undefined && alt.length === 0) return

  const block: Block = {
    id: wc.ctx.id(),
    type: 'figure',
    text: alt,
    ...(asset !== undefined
      ? {
          html: `<img src="${escapeHtmlAttribute(absolute ?? src ?? '')}" alt="${escapeHtmlAttribute(alt)}">`,
        }
      : {}),
    locator: { anchor },
    hash: sha256Hex(alt || (absolute ?? anchor)),
  }
  wc.blocks.push(block)
  wc.tree.attach(block.id)
}

async function walkElement(wc: WalkContext, el: Element): Promise<void> {
  const tag = el.tagName.toLowerCase()
  if (SKIP_TAGS.has(tag)) return

  const anchor = nextAnchor(wc, el)

  const figureImage = soleImage(el)
  if (figureImage !== undefined) {
    await pushFigure(wc, figureImage, anchor)
    return
  }

  const type = blockTypeForTag(tag)
  if (type === undefined) return

  if (type === 'heading') {
    const level = Number(tag[1])
    const text = (el.textContent ?? '').trim()
    if (text.length > 0) wc.tree.pushHeading(wc.ctx.id(), text, level)
    return
  }

  if (type === 'code') {
    const code = el.querySelector('code') ?? el
    const text = (code.textContent ?? '').replace(/\n$/, '')
    const block: Block = {
      id: wc.ctx.id(),
      type,
      text,
      html: el.outerHTML,
      locator: { anchor },
      hash: sha256Hex(text),
    }
    wc.blocks.push(block)
    wc.tree.attach(block.id)
    return
  }

  if (type === 'table' || type === 'list') {
    const text = type === 'table' ? tableText(el) : listText(el)
    if (text.trim().length === 0) return
    const block: Block = {
      id: wc.ctx.id(),
      type,
      text,
      html: el.outerHTML,
      locator: { anchor },
      hash: sha256Hex(text),
    }
    wc.blocks.push(block)
    wc.tree.attach(block.id)
    return
  }

  // paragraph / blockquote / a generic <div> of prose, or a bare top-level equation: all three
  // are converted through Turndown so an inline link, an emphasis, an inline code span or an
  // equation survives — see `html-to-markdown.ts`. The cast is safe: every node this walk sees
  // comes from an HTML document jsdom parsed, so a generic `Element` here is always really an
  // `HTMLElement` at runtime.
  //
  // A bare `<math>` needs one extra step first: Turndown only ever applies a rule to a
  // *descendant* of whatever node it is handed, converting the root's own children instead of
  // the root itself — exactly what a paragraph wants (its inline content, unwrapped), but wrong
  // for `<math>`, whose *own* tag is what the `mathAnnotation` rule matches. Wrapping it in a
  // throwaway `<div>` makes it a child of something, so the rule actually sees it.
  const target =
    type === 'equation'
      ? (() => {
          const wrapper = el.ownerDocument.createElement('div')
          wrapper.appendChild(el.cloneNode(true))
          return wrapper
        })()
      : el
  const text = htmlToMarkdown(wc.turndown, target as unknown as HTMLElement)
  if (text.length === 0) return
  const block: Block = {
    id: wc.ctx.id(),
    type: type === 'equation' ? 'equation' : 'paragraph',
    text,
    locator: { anchor },
    hash: sha256Hex(text),
  }
  wc.blocks.push(block)
  wc.tree.attach(block.id)
}

export interface ParseWebPageDeps {
  fetchImage?: WebImageFetcher
}

export async function parseWebPage(
  input: ParseInput,
  ctx: ParseContext,
  deps: ParseWebPageDeps = {},
): Promise<SourceDoc> {
  const envelope = JSON.parse(new TextDecoder().decode(input.bytes)) as WebPageEnvelope
  const extracted = await extractArticle(envelope.html, envelope.url)

  const dom = new JSDOM(extracted.html, { url: envelope.url })
  const root = contentRoot(dom.window.document.body)

  const wc: WalkContext = {
    ctx,
    turndown: createHtmlToMarkdown(),
    fetchImage: deps.fetchImage ?? createDefaultImageFetcher(envelope.url),
    pageUrl: envelope.url,
    blocks: [],
    assets: [],
    tree: createSectionTree(() => ctx.id(), input.fallbackTitle),
    elementIndex: 0,
    imagesFetched: 0,
    imageBytesFetched: 0,
    imageCapHit: false,
  }

  for (const child of [...root.childNodes]) {
    if (isElement(child)) await walkElement(wc, child)
  }

  const warnings = [...extracted.warnings]
  if (envelope.rendered) {
    warnings.push(
      'The static page had too little text; a hidden browser window rendered it instead',
    )
  }
  if (wc.blocks.length === 0) {
    warnings.push('No readable content was found on this page')
  }
  if (wc.imageCapHit) {
    warnings.push(
      `This page has more images than the ${MAX_IMAGES_PER_DOCUMENT}-image / ${MAX_TOTAL_IMAGE_BYTES}-byte per-document limit; the rest were skipped`,
    )
  }

  const language =
    extracted.language ?? detectLanguage(wc.blocks.map((block) => block.text).join('\n'))

  return {
    id: ctx.id(),
    kind: 'web',
    title: extracted.title ?? input.fallbackTitle,
    language,
    sections: wc.tree.roots,
    blocks: wc.blocks,
    assets: wc.assets,
    meta: {
      warnings,
      origin: {
        // Prefers the page's own `<link rel="canonical">` over the URL actually fetched: the
        // same article reached via `?utm_source=…`, an AMP mirror, or a share link would
        // otherwise cite and (on a later re-fetch) resolve to a different URL every time
        // (`reviewer` finding). `wc.pageUrl` — what image/link resolution and the same-origin
        // check are based on — deliberately stays the *fetched* URL regardless: a canonical tag
        // can point at a different domain (the AMP-to-original case), which would be the wrong
        // base for the page's own relative URLs.
        url: extracted.canonicalUrl ?? envelope.url,
        fetchedAt: envelope.fetchedAt,
        ...(extracted.author !== null ? { author: extracted.author } : {}),
      },
    },
  }
}
