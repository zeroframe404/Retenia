import { XMLParser } from 'fast-xml-parser'
import { strFromU8, unzipSync } from 'fflate'
import { detectLanguage } from '../detect-language'
import { sha256Hex } from '../hash'
import type { ParseContext } from '../parse-context'
import type { ParseInput } from '../parse-input'
import type { Asset, Block, Section, SourceDoc } from '../source-doc'

/**
 * PPTX (`docs/spec/05-ingestion-rag.md` §1: "unzip and parse `ppt/slides/slideN.xml`
 * directly (~150 lines: titles, text bodies, notes, images)"). One `Section` per slide —
 * PPTX has no heading depth beyond that. Shape order within a slide collapses to "title,
 * then body text in document order, then images": `<p:sp>`/`<p:pic>` siblings each keep
 * their own relative order once parsed, but the interleaving between the two kinds is not
 * reconstructed, which is the same simplification the spec's own estimate implies.
 */

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['p:sldId', 'Relationship', 'p:sp', 'p:pic', 'a:p', 'a:r'].includes(name),
})

interface RelEntry {
  id: string
  target: string
}

function readRels(files: Record<string, Uint8Array>, relsPath: string): RelEntry[] {
  const bytes = files[relsPath]
  if (bytes === undefined) return []
  const parsed = xmlParser.parse(strFromU8(bytes))
  const rels = parsed.Relationships?.Relationship ?? []
  return rels
    .map((r: Record<string, unknown>) => ({
      id: r['@_Id'],
      target: r['@_Target'],
      type: r['@_Type'],
    }))
    .filter(
      (r: { id: unknown; target: unknown }) =>
        typeof r.id === 'string' && typeof r.target === 'string',
    )
}

/** `../media/image1.png` (from `ppt/slides/_rels/slideN.xml.rels`), resolved against the
 *  directory the relationship file's *subject* lives in (`ppt/slides/`). */
function resolveTarget(baseDir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const segments = `${baseDir}${target}`.split('/')
  const resolved: string[] = []
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') resolved.pop()
    else resolved.push(segment)
  }
  return resolved.join('/')
}

function slideOrder(files: Record<string, Uint8Array>): string[] {
  const presentation = files['ppt/presentation.xml']
  if (presentation === undefined)
    throw new Error('Not a valid PPTX: ppt/presentation.xml is missing')
  const parsed = xmlParser.parse(strFromU8(presentation))
  const sldIds: Array<Record<string, unknown>> =
    parsed['p:presentation']?.['p:sldIdLst']?.['p:sldId'] ?? []
  const rels = new Map(
    readRels(files, 'ppt/_rels/presentation.xml.rels').map((r) => [r.id, r.target]),
  )

  const paths: string[] = []
  for (const sldId of sldIds) {
    const rid = sldId['@_r:id']
    const target = typeof rid === 'string' ? rels.get(rid) : undefined
    if (target) paths.push(resolveTarget('ppt/', target))
  }
  return paths
}

/** All `<a:t>` runs under `node`, in document order, one string per `<a:p>` paragraph
 *  (empty paragraphs are skipped). Works for both a shape's `txBody` and a notes slide. */
function paragraphTexts(node: unknown): string[] {
  const paragraphs: Array<Record<string, unknown>> = collectByTag(node, 'a:p')
  return paragraphs
    .map((p) => {
      const runs: Array<Record<string, unknown>> = Array.isArray(p['a:r'])
        ? p['a:r']
        : p['a:r']
          ? [p['a:r']]
          : []
      return runs.map((r) => (typeof r['a:t'] === 'string' ? r['a:t'] : '')).join('')
    })
    .filter((text) => text.trim().length > 0)
}

/** Depth-first collection of every object keyed `tag` anywhere under `node` — fast-xml-parser
 *  nests same-named descendants at different depths (a shape's `a:p` vs. a table cell's), and
 *  walking the whole subtree is simpler and just as correct as tracking every intermediate
 *  container tag by name. */
function collectByTag(node: unknown, tag: string): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = []
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (value === null || typeof value !== 'object') return
    const obj = value as Record<string, unknown>
    if (tag in obj) {
      const child = obj[tag]
      if (Array.isArray(child)) found.push(...child)
      else found.push(child as Record<string, unknown>)
    }
    for (const key of Object.keys(obj)) {
      if (key === tag) continue
      visit(obj[key])
    }
  }
  visit(node)
  return found
}

function isTitlePlaceholder(shape: Record<string, unknown>): boolean {
  const ph = findPlaceholder(shape)
  return ph === 'title' || ph === 'ctrTitle'
}

function findPlaceholder(shape: Record<string, unknown>): string | undefined {
  const nvPr = (shape['p:nvSpPr'] as Record<string, unknown> | undefined)?.['p:nvPr'] as
    | Record<string, unknown>
    | undefined
  const ph = nvPr?.['p:ph'] as Record<string, unknown> | undefined
  const type = ph?.['@_type']
  return typeof type === 'string' ? type : undefined
}

interface SlideImage {
  relId: string
}

function collectImageRelIds(node: unknown): SlideImage[] {
  return collectByTag(node, 'p:blipFill')
    .map((fill) => {
      const blip = fill['a:blip'] as Record<string, unknown> | undefined
      const relId = blip?.['@_r:embed']
      return typeof relId === 'string' ? { relId } : undefined
    })
    .filter((x): x is SlideImage => x !== undefined)
}

export async function parsePptx(input: ParseInput, ctx: ParseContext): Promise<SourceDoc> {
  const files = unzipSync(input.bytes)
  const slidePaths = slideOrder(files)

  const blocks: Block[] = []
  const assets: Asset[] = []
  const sections: Section[] = []
  const warnings: string[] = []

  for (const [index, slidePath] of slidePaths.entries()) {
    const bytes = files[slidePath]
    if (bytes === undefined) {
      warnings.push(`Slide "${slidePath}" was declared but not found in the PPTX and was skipped`)
      continue
    }
    const parsed = xmlParser.parse(strFromU8(bytes))
    const spTree = parsed['p:sld']?.['p:cSld']?.['p:spTree'] ?? {}
    const shapes: Array<Record<string, unknown>> = spTree['p:sp'] ?? []

    const slideBlockIds: string[] = []
    // OPC rule, not a naming guess: a part's relationships always live at
    // `<dir>/_rels/<filename>.rels` alongside it.
    const relsPath = slidePath.replace(/\/([^/]+)$/, '/_rels/$1.rels')
    const slideRelsList = readRels(files, relsPath)
    const slideRelsById = new Map(slideRelsList.map((r) => [r.id, r]))

    const titleShape = shapes.find(isTitlePlaceholder)
    const titleText = titleShape ? paragraphTexts(titleShape).join(' ') : undefined
    let titleBlock: Block | undefined
    if (titleText && titleText.length > 0) {
      titleBlock = {
        id: ctx.id(),
        type: 'heading',
        text: titleText,
        locator: { page: index + 1, anchor: `${index}/title` },
        hash: sha256Hex(titleText),
      }
      blocks.push(titleBlock)
      slideBlockIds.push(titleBlock.id)
    }

    for (const shape of shapes) {
      if (shape === titleShape) continue
      for (const [pIndex, text] of paragraphTexts(shape).entries()) {
        const block: Block = {
          id: ctx.id(),
          type: 'paragraph',
          text,
          locator: { page: index + 1, anchor: `${index}/body/${pIndex}` },
          hash: sha256Hex(text),
        }
        blocks.push(block)
        slideBlockIds.push(block.id)
      }
    }

    for (const image of collectImageRelIds(spTree)) {
      const rel = slideRelsById.get(image.relId)
      const target = rel ? resolveTarget('ppt/slides/', rel.target) : undefined
      const imageBytes = target ? files[target] : undefined
      if (imageBytes === undefined) continue
      const ext = target?.split('.').pop()?.toLowerCase()
      const mime =
        ext === 'png'
          ? 'image/png'
          : ext === 'gif'
            ? 'image/gif'
            : ext === 'svg'
              ? 'image/svg+xml'
              : 'image/jpeg'
      const asset = await ctx.putAsset(imageBytes, mime, 'image')
      assets.push(asset)
      const block: Block = {
        id: ctx.id(),
        type: 'figure',
        text: '',
        locator: { page: index + 1, anchor: `${index}/image/${assets.length - 1}` },
        hash: sha256Hex(`${slidePath}#${assets.length - 1}`),
      }
      asset.locator = block.locator
      blocks.push(block)
      slideBlockIds.push(block.id)
    }

    const notesRel = slideRelsList.find((r) => r.target.includes('notesSlide'))
    const notesTarget = notesRel ? resolveTarget('ppt/slides/', notesRel.target) : undefined
    const notesBytes = notesTarget ? files[notesTarget] : undefined
    if (notesBytes !== undefined) {
      const notesParsed = xmlParser.parse(strFromU8(notesBytes))
      const notesText = paragraphTexts(notesParsed['p:notes']?.['p:cSld']?.['p:spTree']).join('\n')
      if (notesText.trim().length > 0) {
        const block: Block = {
          id: ctx.id(),
          type: 'caption',
          text: notesText,
          locator: { page: index + 1, anchor: `${index}/notes` },
          hash: sha256Hex(notesText),
        }
        blocks.push(block)
        slideBlockIds.push(block.id)
      }
    }

    sections.push({
      id: ctx.id(),
      title: titleText ?? `Slide ${index + 1}`,
      level: 1,
      blocks: slideBlockIds,
      children: [],
    })
  }

  const language = detectLanguage(blocks.map((b) => b.text).join('\n'))

  return {
    id: ctx.id(),
    kind: 'pptx',
    title: sections[0]?.title ?? input.fallbackTitle,
    language,
    sections,
    blocks,
    assets,
    meta: { pageCount: sections.length, warnings },
  }
}
