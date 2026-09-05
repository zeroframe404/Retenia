/// <reference path="../css.d.ts" />
import 'katex/dist/katex.min.css'
import ReactMarkdown, { type Components, defaultUrlTransform } from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { cn } from '../lib/cn'
import { markdownSanitizeSchema } from '../lib/markdown-sanitize-schema'
import { CodeBlock } from './code-block'
import { KATEX_OPTIONS } from './katex-inline'
import { MermaidView } from './mermaid-view'

export interface MarkdownViewProps {
  /** Markdown/GFM source (headings, tables, task lists, strikethrough), plus
   * `$inline$`/`$$block$$` LaTeX math and fenced code — including ```mermaid diagrams,
   * which render via `MermaidView` instead of as highlighted code. */
  children: string
  /**
   * Render into a `<span>` with paragraphs unwrapped, for a caller whose slot only accepts
   * phrasing content — a token inside a `<button>`, a table cell, a label.
   *
   * It is a rendering mode, not a parsing mode: the same Markdown, the same plugins and the same
   * sanitizer run either way, so `**bold**` and `$x^2$` come out formatted instead of as source.
   * A block construct in an inline slot (a fenced block, a list) still renders as the block it
   * is; short labels do not carry those, and silently dropping them would be worse than the
   * markup being unusual.
   */
  inline?: boolean
  className?: string
}

function languageFromClassName(className: string | undefined): string | undefined {
  return /language-(\S+)/.exec(className ?? '')?.[1]
}

/**
 * `react-markdown`'s own URL allowlist — `http`, `https`, `mailto`, `tel` and relative
 * URLs — widened by the app's `media://` scheme, which is how source-library media is
 * served (docs/spec/07-architecture.md §3).
 *
 * Without this, `defaultUrlTransform` blanks every `media://` URL before
 * `markdownSanitizeSchema` sees it, so the schema's `media` allowance on `src` is
 * unreachable and a `![...](media://...)` image in a lesson body silently renders empty.
 * Every other scheme still goes through the default and is blanked there, then checked
 * again by the sanitizer: two independent allowlists, both fail-closed.
 */
function urlTransform(url: string): string {
  return url.startsWith('media://') ? url : defaultUrlTransform(url)
}

const components: Components = {
  // react-markdown wraps fenced code in its own <pre><code>; the `code` renderer below
  // already produces the right wrapper (a `CodeBlock`/`MermaidView` or a bare <pre>), so
  // this just unwraps react-markdown's own <pre> to avoid nesting block elements inside it.
  pre({ children }) {
    return <>{children}</>
  },
  code({ className, children }) {
    const language = languageFromClassName(className)
    const isFenced = className?.includes('language-')

    if (!isFenced) {
      return (
        <code className="bg-neutral-100 dark:bg-neutral-800 rounded px-1.5 py-0.5 font-mono text-[0.9em]">
          {children}
        </code>
      )
    }

    const code = String(children).replace(/\n$/, '')
    if (language === 'mermaid') {
      return <MermaidView chart={code} />
    }
    return <CodeBlock code={code} language={language} />
  },
  table({ children }) {
    return (
      <div className="overflow-x-auto">
        <table>{children}</table>
      </div>
    )
  },
}

/** `components`, minus the one wrapper that is not phrasing content. `<p>` inside a `<button>`
 *  or a `<span>` is invalid HTML, and it is the element every paragraph of prose produces. */
const inlineComponents: Components = {
  ...components,
  p({ children }) {
    return <>{children}</>
  },
}

/** Renders trusted-shape-but-untrusted-content Markdown — lesson theory, AI tutor
 * answers, source excerpts — with GFM tables/task-lists/strikethrough, LaTeX math
 * (KaTeX), syntax-highlighted code (Shiki, via `CodeBlock`) and Mermaid diagrams (via the
 * sandboxed `MermaidView`). Raw HTML in the source is never rendered as markup (no
 * `rehype-raw`); anything `rehype-katex` itself produces is sanitized against a schema
 * that only widens `defaultSchema` enough for KaTeX's own output, and KaTeX itself runs
 * with `KATEX_OPTIONS` — untrusted LaTeX cannot author HTML or ask for an unbounded
 * layout. */
export function MarkdownView({ children, inline = false, className }: MarkdownViewProps) {
  const markdown = (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[
        [rehypeKatex, KATEX_OPTIONS],
        [rehypeSanitize, markdownSanitizeSchema],
      ]}
      components={inline ? inlineComponents : components}
      urlTransform={urlTransform}
    >
      {children}
    </ReactMarkdown>
  )

  if (inline) {
    return <span className={cn('text-text', className)}>{markdown}</span>
  }

  return (
    <div
      className={cn(
        'text-text flex flex-col gap-4 text-sm leading-relaxed',
        '[&_h1]:font-display [&_h1]:text-2xl [&_h1]:font-semibold',
        '[&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold',
        '[&_h3]:font-display [&_h3]:text-lg [&_h3]:font-semibold',
        '[&_a]:text-brand-600 dark:[&_a]:text-brand-400 [&_a]:underline [&_a]:underline-offset-2',
        '[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5',
        '[&_blockquote]:border-border [&_blockquote]:text-muted [&_blockquote]:border-l-2 [&_blockquote]:pl-4',
        '[&_hr]:border-border',
        '[&_table]:w-full [&_table]:border-collapse [&_table]:text-left',
        '[&_th]:border-border [&_th]:border-b [&_th]:px-3 [&_th]:py-1.5 [&_th]:font-semibold',
        '[&_td]:border-border [&_td]:border-b [&_td]:px-3 [&_td]:py-1.5',
        '[&_img]:rounded-md',
        className,
      )}
    >
      {markdown}
    </div>
  )
}
