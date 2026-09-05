import { XMLParser } from 'fast-xml-parser'
import { strFromU8, unzipSync } from 'fflate'
import { type HTMLElement, NodeType, parse as parseHtml } from 'node-html-parser'
import { detectLanguage } from '../detect-language'
import { sha256Hex } from '../hash'
import type { ParseContext } from '../parse-context'
import type { ParseInput } from '../parse-input'
import { createSectionTree } from '../section-tree'
import type { Asset, Block, BlockType, Section, SourceDoc } from '../source-doc'

/**
 * EPUB (`docs/spec/05-ingestion-rag.md` §1): unzip, follow the OCF container to the OPF
 * package document for spine order and the manifest, then walk each chapter's XHTML the
 * same way DOCX's HTML is walked. Chapter titles come from the nav document (EPUB3) or the
 * NCX (EPUB2) when either resolves; otherwise from the chapter's own first heading.
 */

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['rootfile', 'item', 'itemref', 'navPoint', 'li'].includes(name),
})

function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i + 1)
}

/** Resolves an OPF-relative href (which may itself carry `../`) against the OPF's own
 *  directory, without ever escaping the zip's flat namespace. */
function resolveHref(baseDir: string, href: string): string {
  const stripped = href.split('#')[0] ?? href
  const segments = `${baseDir}${stripped}`.split('/')
  const resolved: string[] = []
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') resolved.pop()
    else resolved.push(segment)
  }
  return resolved.join('/')
}

interface ManifestItem {
  id: string
  href: string
  mediaType: string
  properties?: string
}

interface Package {
  baseDir: string
  title: string | undefined
  language: string | undefined
  manifest: Map<string, ManifestItem>
  spineHrefs: string[]
  tocNcxHref: string | undefined
}

function readContainer(files: Record<string, Uint8Array>): string {
  const containerXml = files['META-INF/container.xml']
  if (containerXml === undefined) {
    throw new Error('Not a valid EPUB: META-INF/container.xml is missing')
  }
  const parsed = xmlParser.parse(strFromU8(containerXml))
  const rootfile = parsed.container?.rootfiles?.rootfile?.[0]
  const path = rootfile?.['@_full-path']
  if (typeof path !== 'string') {
    throw new Error('Not a valid EPUB: no rootfile declared in META-INF/container.xml')
  }
  return path
}

function readPackage(files: Record<string, Uint8Array>, opfPath: string): Package {
  const opfBytes = files[opfPath]
  if (opfBytes === undefined) throw new Error(`Not a valid EPUB: ${opfPath} is missing`)
  const baseDir = dirname(opfPath)
  const parsed = xmlParser.parse(strFromU8(opfBytes))
  const pkg = parsed.package ?? {}

  const metadata = pkg.metadata ?? {}
  const title = typeof metadata['dc:title'] === 'string' ? metadata['dc:title'] : undefined
  const language = typeof metadata['dc:language'] === 'string' ? metadata['dc:language'] : undefined

  const manifest = new Map<string, ManifestItem>()
  for (const item of pkg.manifest?.item ?? []) {
    const id = item['@_id']
    const href = item['@_href']
    const mediaType = item['@_media-type']
    if (typeof id === 'string' && typeof href === 'string' && typeof mediaType === 'string') {
      manifest.set(id, { id, href, mediaType, properties: item['@_properties'] })
    }
  }

  const spineHrefs: string[] = []
  for (const itemref of pkg.spine?.itemref ?? []) {
    const idref = itemref['@_idref']
    const item = typeof idref === 'string' ? manifest.get(idref) : undefined
    if (item) spineHrefs.push(resolveHref(baseDir, item.href))
  }

  const tocId = pkg.spine?.['@_toc']
  const tocItem = typeof tocId === 'string' ? manifest.get(tocId) : undefined
  const navItem = [...manifest.values()].find((item) => item.properties?.includes('nav'))
  const tocNcxHref = tocItem
    ? resolveHref(baseDir, tocItem.href)
    : navItem
      ? resolveHref(baseDir, navItem.href)
      : undefined

  return { baseDir, title, language, manifest, spineHrefs, tocNcxHref }
}

/** href (already resolved to the zip's flat namespace) → chapter title, from an EPUB3 nav
 *  document's `<nav epub:type="toc">` or an EPUB2 `toc.ncx`'s `navPoint`s — whichever the
 *  package declared. Best-effort: a title that cannot be resolved falls back to the
 *  chapter's own first heading in the caller. */
function readTocTitles(
  files: Record<string, Uint8Array>,
  tocHref: string | undefined,
): Map<string, string> {
  const titles = new Map<string, string>()
  if (tocHref === undefined) return titles
  const bytes = files[tocHref]
  if (bytes === undefined) return titles
  const baseDir = dirname(tocHref)
  const text = strFromU8(bytes)

  if (tocHref.endsWith('.ncx')) {
    const parsed = xmlParser.parse(text)
    const walk = (points: unknown[]): void => {
      for (const point of points) {
        const p = point as Record<string, unknown>
        const label = (p.navLabel as { text?: string } | undefined)?.text
        const src = (p.content as { '@_src'?: string } | undefined)?.['@_src']
        if (typeof label === 'string' && typeof src === 'string') {
          titles.set(resolveHref(baseDir, src), label)
        }
        if (Array.isArray(p.navPoint)) walk(p.navPoint)
      }
    }
    walk(parsed.ncx?.navMap?.navPoint ?? [])
    return titles
  }

  // EPUB3 nav document: plain XHTML, easier to read with the HTML parser than as XML.
  const root = parseHtml(text)
  const toc = root.querySelector('nav[epub\\:type="toc"], nav') ?? root
  for (const link of toc.querySelectorAll('a')) {
    const href = link.getAttribute('href')
    const label = link.text.trim()
    if (href && label) titles.set(resolveHref(baseDir, href), label)
  }
  return titles
}

function blockTypeForTag(tag: string): BlockType | undefined {
  if (/^h[1-6]$/.test(tag)) return 'heading'
  switch (tag) {
    case 'p':
      return 'paragraph'
    case 'ul':
    case 'ol':
      return 'list'
    case 'table':
      return 'table'
    default:
      return undefined
  }
}

function listText(el: HTMLElement): string {
  return el
    .querySelectorAll('li')
    .map((li) => li.text.trim())
    .join('\n')
}

function tableText(el: HTMLElement): string {
  return el
    .querySelectorAll('tr')
    .map((row) =>
      row
        .querySelectorAll('td, th')
        .map((cell) => cell.text.trim())
        .join(' | '),
    )
    .join('\n')
}

function soleImage(el: HTMLElement): HTMLElement | undefined {
  const images = el.querySelectorAll('img')
  if (images.length !== 1) return undefined
  return el.text.trim().length === 0 ? images[0] : undefined
}

export async function parseEpub(input: ParseInput, ctx: ParseContext): Promise<SourceDoc> {
  const files = unzipSync(input.bytes)
  const opfPath = readContainer(files)
  const pkg = readPackage(files, opfPath)
  const tocTitles = readTocTitles(files, pkg.tocNcxHref)

  const blocks: Block[] = []
  const assets: Asset[] = []
  const chapters: Section[] = []
  const warnings: string[] = []

  for (const [chapterIndex, href] of pkg.spineHrefs.entries()) {
    const bytes = files[href]
    if (bytes === undefined) {
      warnings.push(`Spine item "${href}" was declared but not found in the EPUB and was skipped`)
      continue
    }
    const root = parseHtml(strFromU8(bytes))
    const tree = createSectionTree(() => ctx.id(), href)
    let chapterFirstHeading: string | undefined
    let elementIndex = 0

    const pushBlock = (block: Block): void => {
      blocks.push(block)
      tree.attach(block.id)
    }

    for (const node of root.querySelectorAll('body > *')) {
      const anchor = `${chapterIndex}/${elementIndex}`
      elementIndex += 1
      if (node.nodeType !== NodeType.ELEMENT_NODE) continue
      const tag = node.rawTagName?.toLowerCase()
      if (tag === undefined) continue

      if (tag === 'img') {
        const asset = await embedImage(node, files, href, ctx)
        if (asset) assets.push(asset)
        const alt = node.getAttribute('alt') ?? ''
        const block: Block = {
          id: ctx.id(),
          type: 'figure',
          text: alt,
          locator: { anchor },
          hash: sha256Hex(alt),
        }
        pushBlock(block)
        continue
      }

      const type = blockTypeForTag(tag)
      if (type === undefined) continue

      if (type === 'paragraph') {
        const figure = soleImage(node)
        if (figure) {
          const asset = await embedImage(figure, files, href, ctx)
          if (asset) assets.push(asset)
          const alt = figure.getAttribute('alt') ?? ''
          const block: Block = {
            id: ctx.id(),
            type: 'figure',
            text: alt,
            locator: { anchor },
            hash: sha256Hex(alt),
          }
          pushBlock(block)
          continue
        }
      }

      const text =
        type === 'list' ? listText(node) : type === 'table' ? tableText(node) : node.text.trim()
      if (type === 'heading') {
        const level = Number(tag[1])
        tree.pushHeading(ctx.id(), text, level)
        chapterFirstHeading ??= text
        continue
      }

      const html = type === 'list' || type === 'table' ? node.outerHTML : undefined
      const block: Block = {
        id: ctx.id(),
        type,
        text,
        ...(html !== undefined ? { html } : {}),
        locator: { anchor },
        hash: sha256Hex(text),
      }
      pushBlock(block)
    }

    const title = tocTitles.get(href) ?? chapterFirstHeading ?? href
    if (tree.roots.length === 1 && tree.roots[0]?.level === 0) {
      // The whole chapter had no heading of its own: fold its synthetic preamble into one
      // section named for the chapter, rather than nesting a redundant "chapter" wrapper
      // around an identically-named single child.
      const [only] = tree.roots
      // biome-ignore lint/style/noNonNullAssertion: length just checked above
      chapters.push({ ...only!, title })
    } else {
      chapters.push({ id: ctx.id(), title, level: 0, blocks: [], children: tree.roots })
    }
  }

  const language = pkg.language ?? detectLanguage(blocks.map((b) => b.text).join('\n'))

  return {
    id: ctx.id(),
    kind: 'epub',
    title: pkg.title ?? input.fallbackTitle,
    language: language ?? null,
    sections: chapters,
    blocks,
    assets,
    meta: { warnings },
  }
}

async function embedImage(
  img: HTMLElement,
  files: Record<string, Uint8Array>,
  chapterHref: string,
  ctx: ParseContext,
): Promise<Asset | undefined> {
  const src = img.getAttribute('src')
  if (!src) return undefined
  const href = resolveHref(dirname(chapterHref), src)
  const bytes = files[href]
  if (bytes === undefined) return undefined
  const ext = href.split('.').pop()?.toLowerCase()
  const mime =
    ext === 'png'
      ? 'image/png'
      : ext === 'gif'
        ? 'image/gif'
        : ext === 'svg'
          ? 'image/svg+xml'
          : 'image/jpeg'
  return ctx.putAsset(bytes, mime, 'image')
}
