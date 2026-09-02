import type { Schema } from 'hast-util-sanitize'
import { defaultSchema } from 'rehype-sanitize'

const MATHML_TAGS = [
  'math',
  'semantics',
  'annotation',
  'mrow',
  'mi',
  'mo',
  'mn',
  'ms',
  'mtext',
  'mspace',
  'msup',
  'msub',
  'msubsup',
  'mfrac',
  'msqrt',
  'mroot',
  'mtable',
  'mtr',
  'mtd',
  'mstyle',
  'munder',
  'mover',
  'munderover',
  'mpadded',
  'mphantom',
  'menclose',
]

const SVG_TAGS = ['svg', 'g', 'path', 'line', 'rect', 'text', 'tspan']

/**
 * `defaultSchema` (GitHub-style sanitation) plus the extra markup KaTeX's own HTML+MathML
 * renderer produces for math (`<span class="katex">…</span>` with heavy inline
 * positioning `style`, plus a MathML fallback tree and a handful of SVG glyphs for large
 * delimiters). Nothing else gets a wider allowance — math source can come from
 * AI-generated content, so `MarkdownView` sanitizes even though `rehype-katex` itself
 * only ever emits its own fixed markup, never the raw math source as HTML.
 */
export const markdownSanitizeSchema: Schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'span', ...MATHML_TAGS, ...SVG_TAGS],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'className', 'style'],
    span: ['className', 'style', 'ariaHidden', 'role'],
    math: ['xmlns', 'display'],
    annotation: ['encoding'],
    svg: ['xmlns', 'width', 'height', 'viewBox', 'preserveAspectRatio', 'role', 'focusable'],
    path: ['d', 'fill', 'transform'],
    g: ['transform'],
    text: ['x', 'y', 'fontFamily', 'fontSize'],
  },
}
