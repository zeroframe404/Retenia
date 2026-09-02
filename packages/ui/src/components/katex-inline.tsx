/// <reference path="../css.d.ts" />
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { useMemo } from 'react'
import { cn } from '../lib/cn'

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
 * rather than throwing, since the source can come from AI-generated content. */
export function KatexInline({ math, displayMode, className }: KatexInlineProps) {
  const html = useMemo(
    () =>
      katex.renderToString(math, {
        displayMode,
        throwOnError: false,
      }),
    [math, displayMode],
  )

  return (
    <span
      className={cn(displayMode && 'block text-center', className)}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX's own renderer output — a fixed set of span/math tags generated from the LaTeX source, not arbitrary HTML.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
