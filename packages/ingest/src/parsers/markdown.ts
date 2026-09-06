import type { Content, Root } from 'mdast'
import { toString as mdastToString } from 'mdast-util-to-string'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { parse as parseYaml } from 'yaml'
import { detectLanguage } from '../detect-language'
import { sha256Hex } from '../hash'
import type { ParseContext } from '../parse-context'
import type { ParseInput } from '../parse-input'
import { createSectionTree } from '../section-tree'
import type { Block, BlockType, SourceDoc } from '../source-doc'

/**
 * Markdown/TXT (`docs/spec/05-ingestion-rag.md` §1): remark to mdast, frontmatter kept in
 * `meta`, headings become the section tree. `.txt` reuses this parser unchanged — plain text
 * is valid Markdown with only paragraphs (`parse-document.ts` decides the `kind`; frontmatter
 * parsing is skipped for `text` sources since a `.txt` file has none).
 */

const decoder = new TextDecoder('utf-8')

function textContent(node: Content): string {
  return mdastToString(node).trim()
}

/** A flattened text fallback for a list/table — `mdastToString` alone runs every leaf
 *  together with no separator, which is unreadable once nesting is gone; `html` is what
 *  keeps the real structure for anything that needs it. */
function flattenedText(node: Content): string {
  if (node.type === 'list') {
    return node.children.map((item) => textContent(item)).join('\n')
  }
  if (node.type === 'table') {
    return node.children
      .map((row) => row.children.map((cell) => textContent(cell)).join(' | '))
      .join('\n')
  }
  return textContent(node)
}

function rawSlice(source: string, node: Content): string | undefined {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (start === undefined || end === undefined) return undefined
  return source.slice(start, end)
}

/** Whether a paragraph is nothing but a single image — Markdown's way of embedding a figure. */
function soleImage(node: Content): { alt: string } | undefined {
  if (node.type !== 'paragraph' || node.children.length !== 1) return undefined
  const child = node.children[0]
  if (child?.type !== 'image') return undefined
  return { alt: child.alt ?? '' }
}

function blockTypeFor(node: Content): BlockType | undefined {
  switch (node.type) {
    case 'heading':
      return 'heading'
    case 'paragraph':
    case 'blockquote':
    case 'html':
      return 'paragraph'
    case 'list':
      return 'list'
    case 'table':
      return 'table'
    case 'code':
      return 'code'
    default:
      return undefined
  }
}

export interface ParseMarkdownOptions {
  /** `false` for a `.txt` source: skips frontmatter parsing, which only applies to `.md`. */
  frontmatter?: boolean
}

export async function parseMarkdown(
  input: ParseInput,
  ctx: ParseContext,
  options: ParseMarkdownOptions = {},
): Promise<SourceDoc> {
  const source = decoder.decode(input.bytes)
  const frontmatterEnabled = options.frontmatter ?? true

  const processor = unified().use(remarkParse).use(remarkGfm)
  if (frontmatterEnabled) processor.use(remarkFrontmatter, ['yaml'])
  const root = processor.parse(source) as Root

  const warnings: string[] = []
  let frontmatterData: Record<string, unknown> | undefined
  let title: string | undefined

  const blocks: Block[] = []
  const tree = createSectionTree(() => ctx.id(), input.fallbackTitle)

  for (const node of root.children) {
    if (node.type === 'yaml') {
      try {
        const parsed = parseYaml(node.value)
        if (parsed !== null && typeof parsed === 'object') {
          frontmatterData = parsed as Record<string, unknown>
          if (typeof frontmatterData.title === 'string') title = frontmatterData.title
        }
      } catch {
        warnings.push('Frontmatter could not be parsed as YAML and was ignored')
      }
      continue
    }

    if (node.type === 'heading') {
      tree.pushHeading(ctx.id(), textContent(node), node.depth)
      if (title === undefined && node.depth === 1) title = textContent(node)
      continue
    }

    const figure = soleImage(node)
    if (figure) {
      // Referenced, not embedded: this parser has no base path to resolve/fetch it from, so
      // there is no `Asset` to add — only the alt text survives.
      const text = figure.alt
      const block: Block = {
        id: ctx.id(),
        type: 'figure',
        text,
        locator: { anchor: String(blocks.length) },
        hash: sha256Hex(text),
      }
      blocks.push(block)
      tree.attach(block.id)
      continue
    }

    const type = blockTypeFor(node)
    if (type === undefined) continue

    const text = node.type === 'code' ? node.value : flattenedText(node)
    const html = type === 'list' || type === 'table' ? rawSlice(source, node) : undefined
    const block: Block = {
      id: ctx.id(),
      type,
      text,
      ...(html !== undefined ? { html } : {}),
      locator: { anchor: String(blocks.length) },
      hash: sha256Hex(text),
    }
    blocks.push(block)
    tree.attach(block.id)
  }

  const language = detectLanguage(blocks.map((b) => b.text).join('\n'))

  return {
    id: ctx.id(),
    kind: frontmatterEnabled ? 'markdown' : 'text',
    title: title ?? input.fallbackTitle,
    language,
    sections: tree.roots,
    blocks,
    assets: [],
    meta: {
      warnings,
      ...(frontmatterData !== undefined ? { frontmatter: frontmatterData } : {}),
    },
  }
}
