import { strFromU8, unzipSync } from 'fflate'
import mammoth from 'mammoth'
import { type HTMLElement, NodeType, parse as parseHtml } from 'node-html-parser'
import { detectLanguage } from '../detect-language'
import { sha256Hex } from '../hash'
import type { ParseContext } from '../parse-context'
import type { ParseInput } from '../parse-input'
import { createSectionTree } from '../section-tree'
import type { Asset, Block, BlockType, SourceDoc } from '../source-doc'

/**
 * DOCX (`docs/spec/05-ingestion-rag.md` §1): `mammoth` converts to HTML (headings, lists,
 * tables, images), which is then walked into blocks the same way EPUB's XHTML is. OMML
 * equations are mammoth's one silent loss — it drops them entirely rather than emitting a
 * placeholder — so this parser counts them straight from the raw XML and surfaces one
 * doc-level warning; reinserting them at their exact position would need a seam mammoth's
 * output does not give (`docs/spec/01-decisions.md` phase F6 prompt 6.1: "note OMML
 * equations are lost (log a warning, keep placeholder)" — the placeholder here is that
 * warning, not an inline block, since mammoth's HTML has already lost their position).
 */

const ASSET_SRC_PREFIX = 'asset:'

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

/** A paragraph whose only meaningful content is one image — mammoth's shape for a figure. */
function soleImage(el: HTMLElement): HTMLElement | undefined {
  const images = el.querySelectorAll('img')
  if (images.length !== 1) return undefined
  return el.text.trim().length === 0 ? images[0] : undefined
}

export function countOmmlEquations(bytes: Uint8Array): number {
  try {
    const files = unzipSync(bytes, { filter: (file) => file.name === 'word/document.xml' })
    const xml = files['word/document.xml']
    if (xml === undefined) return 0
    const text = strFromU8(xml)
    return (text.match(/<m:oMath[ >]/g) ?? []).length
  } catch {
    // Not a real zip, or no `word/document.xml` — the mammoth conversion below will fail
    // with a clearer message than this helper could give.
    return 0
  }
}

export async function parseDocx(input: ParseInput, ctx: ParseContext): Promise<SourceDoc> {
  const buffer = Buffer.from(input.bytes)
  const assets: Asset[] = []

  const result = await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const contentType = image.contentType
        const data = await image.readAsBuffer()
        const asset = await ctx.putAsset(new Uint8Array(data), contentType, 'image')
        assets.push(asset)
        return { src: `${ASSET_SRC_PREFIX}${assets.length - 1}` }
      }),
    },
  )

  // mammoth already warns once per dropped `<m:oMath>` ("An unrecognised element was
  // ignored: {...}oMath") — replaced below by one consolidated count, so it is filtered out
  // here rather than kept alongside a second, redundant warning about the same thing.
  const warnings = result.messages
    .filter((m) => m.type === 'warning' && !m.message.includes('}oMath'))
    .map((m) => m.message)

  const ommlCount = countOmmlEquations(input.bytes)
  if (ommlCount > 0) {
    const plural = ommlCount === 1 ? '' : 's'
    const verb = ommlCount === 1 ? 'is' : 'are'
    warnings.push(
      `${ommlCount} equation${plural} could not be converted and ${verb} not represented in this document`,
    )
  }

  const root = parseHtml(result.value)
  const blocks: Block[] = []
  const tree = createSectionTree(() => ctx.id(), input.fallbackTitle)
  let title: string | undefined
  // The element's own position among the body's top-level children — headings included, and
  // counted whether or not the element became a block — not `blocks.length`. A count of only
  // emitted blocks drifts from the document the moment anything between two blocks is skipped
  // (a heading, an element `blockTypeForTag` does not recognise), so two elements at different
  // real positions could end up sharing one anchor while a third's never matched its own
  // position at all. This one is what `elementIndex` means in `epub.ts` for the same reason:
  // a document-order position a future reader can recompute the same way, from `body > *`.
  let elementIndex = -1

  for (const node of root.childNodes) {
    if (node.nodeType !== NodeType.ELEMENT_NODE) continue
    elementIndex += 1
    const el = node as HTMLElement
    const tag = el.rawTagName.toLowerCase()

    if (tag === 'img') {
      pushFigure(el, elementIndex)
      continue
    }

    const type = blockTypeForTag(tag)
    if (type === undefined) continue

    if (type === 'paragraph') {
      const figure = soleImage(el)
      if (figure) {
        pushFigure(figure, elementIndex)
        continue
      }
    }

    const text = type === 'list' ? listText(el) : type === 'table' ? tableText(el) : el.text.trim()
    if (type === 'heading') {
      const level = Number(tag[1])
      tree.pushHeading(ctx.id(), text, level)
      if (title === undefined && level === 1) title = text
      continue
    }

    const html = type === 'list' || type === 'table' ? el.outerHTML : undefined
    const block: Block = {
      id: ctx.id(),
      type,
      text,
      ...(html !== undefined ? { html } : {}),
      locator: { anchor: String(elementIndex) },
      hash: sha256Hex(text),
    }
    blocks.push(block)
    tree.attach(block.id)
  }

  function pushFigure(img: HTMLElement, elementIndex: number): void {
    const src = img.getAttribute('src') ?? ''
    const alt = img.getAttribute('alt') ?? ''
    const index = src.startsWith(ASSET_SRC_PREFIX) ? Number(src.slice(ASSET_SRC_PREFIX.length)) : -1
    const asset = assets[index]
    const block: Block = {
      id: ctx.id(),
      type: 'figure',
      text: alt,
      locator: { anchor: String(elementIndex) },
      hash: sha256Hex(alt),
    }
    blocks.push(block)
    tree.attach(block.id)
    if (asset) asset.locator = block.locator
  }

  const language = detectLanguage(blocks.map((b) => b.text).join('\n'))

  return {
    id: ctx.id(),
    kind: 'docx',
    title: title ?? input.fallbackTitle,
    language,
    sections: tree.roots,
    blocks,
    assets,
    meta: { warnings },
  }
}
