/// <reference path="../css.d.ts" />
import { fromHtmlIsomorphic } from 'hast-util-from-html-isomorphic'
import katex, { type KatexOptions } from 'katex'
import 'katex/dist/katex.min.css'
import { useMemo } from 'react'
import { cn } from '../lib/cn'
import { renderSanitizedHast } from '../lib/markdown-sanitize-schema'

/**
 * The KaTeX settings every math renderer in this package shares — `MarkdownView` passes
 * the same object to `rehype-katex`. None of them are KaTeX defaults, and all four matter
 * because the LaTeX can come from AI-generated content:
 *
 * - `trust: false` is the default, but nothing in KaTeX's API forces it to stay one, and
 *   it is the single switch that decides whether `\href`, `\url`, `\htmlData`,
 *   `\htmlClass` and `\includegraphics` render at all. Set explicitly so a default change
 *   cannot quietly turn LaTeX into an HTML-authoring language.
 * - `strict: 'ignore'` keeps LaTeX-incompatible input rendering instead of warning on the
 *   console once per expression.
 * - `maxSize` (KaTeX's default is `Infinity`) caps every user-specified length, so
 *   `\rule{100000em}{100000em}` cannot lay out a viewport-sized box.
 * - `maxExpand` bounds macro expansion, so `\def\a{\a}\a` returns an error instead of
 *   hanging the renderer.
 *
 * These bound the two call sites this package owns — `KatexInline` below and `MarkdownView`'s
 * `rehype-katex`. They do **not** bound Mermaid, which reaches KaTeX itself for `$$…$$` in a
 * sequence diagram with its own hard-coded options; that residue is documented on `MermaidView`,
 * which is where the only lever over it (`htmlLabels: false`) lives.
 */
export const KATEX_OPTIONS = {
  maxExpand: 256,
  maxSize: 25,
  strict: 'ignore',
  trust: false,
} satisfies KatexOptions

export interface KatexInlineProps {
  /** LaTeX math source, e.g. `"x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}"`. */
  math: string
  /** Render as a centered display block instead of inline text. */
  displayMode?: boolean
  className?: string
}

/** Renders a single LaTeX expression via KaTeX. `MarkdownView` handles math embedded in
 * prose (via `remark-math`/`rehype-katex`); this is for a standalone formula — e.g. one
 * cloze blank in a math flashcard. Invalid LaTeX renders KaTeX's own inline error text
 * rather than throwing, since the source can come from AI-generated content.
 *
 * KaTeX's markup is parsed into hast and rendered through `renderSanitizedHast` rather
 * than injected as raw HTML: `MarkdownView` already puts the equivalent output through
 * the same schema, and going through React is also what keeps KaTeX's inline positioning
 * styles alive under the packaged app's `style-src` (see `renderSanitizedHast`). */
export function KatexInline({ math, displayMode, className }: KatexInlineProps) {
  const content = useMemo(
    () =>
      renderSanitizedHast(
        fromHtmlIsomorphic(
          katex.renderToString(math, { ...KATEX_OPTIONS, displayMode, throwOnError: false }),
          { fragment: true },
        ),
      ),
    [math, displayMode],
  )

  return <span className={cn(displayMode && 'block text-center', className)}>{content}</span>
}
