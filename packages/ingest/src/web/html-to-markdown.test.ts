import { JSDOM } from 'jsdom'
import katex from 'katex'
import { describe, expect, it } from 'vitest'
import { createHtmlToMarkdown, htmlToMarkdown } from './html-to-markdown'

/**
 * A real DOM element for `html`, via jsdom rather than Turndown's own (domino-based) string
 * parser — required for anything with a `<math>` in it, per `htmlToMarkdown`'s own doc comment.
 */
function element(html: string): HTMLElement {
  const dom = new JSDOM(`<body>${html}</body>`)
  const el = dom.window.document.body.firstElementChild
  if (el === null) throw new Error(`fixture produced no element: ${html}`)
  return el as unknown as HTMLElement
}

describe('createHtmlToMarkdown', () => {
  it('keeps a fenced code block with its language', () => {
    const turndown = createHtmlToMarkdown()
    const md = htmlToMarkdown(
      turndown,
      '<pre><code class="language-python">def f():\n    return 1\n</code></pre>',
    )
    expect(md).toBe('```python\ndef f():\n    return 1\n```')
  })

  it('keeps a footnote reference and its definition as ordinary links', () => {
    const turndown = createHtmlToMarkdown()
    const ref = htmlToMarkdown(
      turndown,
      '<p>See the note<sup id="fnref-1"><a href="#fn-1">1</a></sup>.</p>',
    )
    expect(ref).toContain('[1](#fn-1)')

    const def = htmlToMarkdown(
      turndown,
      '<li id="fn-1">Dunlosky et al. (2013). <a href="#fnref-1">&#8617;</a></li>',
    )
    expect(def).toContain('Dunlosky et al. (2013)')
    expect(def).toContain('[↩](#fnref-1)')
  })

  it('converts raw, untouched KaTeX markup to $…$, without echoing the visual rendering', () => {
    const turndown = createHtmlToMarkdown()
    const rendered = katex.renderToString('E=mc^2', { throwOnError: false, displayMode: false })
    const md = htmlToMarkdown(turndown, element(`<p>Formula ${rendered} here.</p>`))
    expect(md).toBe('Formula $E=mc^2$ here.')
  })

  it('converts raw, untouched display-mode KaTeX markup to $$…$$, on its own', () => {
    const turndown = createHtmlToMarkdown()
    const rendered = katex.renderToString('\\int_0^1 x^2\\,dx', {
      throwOnError: false,
      displayMode: true,
    })
    const md = htmlToMarkdown(turndown, element(`<div>${rendered}</div>`))
    expect(md).toBe('$$\\int_0^1 x^2\\,dx$$')
  })

  it("converts Defuddle's standardized <math data-latex> shorthand", () => {
    const turndown = createHtmlToMarkdown()
    const inline = htmlToMarkdown(
      turndown,
      element('<p>Formula <math data-latex="E=mc^2" display="inline"></math> here.</p>'),
    )
    expect(inline).toBe('Formula $E=mc^2$ here.')

    const block = htmlToMarkdown(
      turndown,
      element('<div><math data-latex="\\int_0^1 x^2\\,dx" display="block"></math></div>'),
    )
    expect(block).toBe('$$\\int_0^1 x^2\\,dx$$')
  })

  it('leaves a <math> element with neither data-latex nor an annotation to its default rendering', () => {
    const turndown = createHtmlToMarkdown()
    const md = htmlToMarkdown(turndown, element('<p>A <math><mi>x</mi></math> plain formula.</p>'))
    expect(md).toBe('A x plain formula.')
  })

  it('preserves inline emphasis and links a bare .text accessor would drop', () => {
    const turndown = createHtmlToMarkdown()
    const md = htmlToMarkdown(
      turndown,
      '<p>Retrieval practice beats <em>re-reading</em>, per <a href="https://example.com/study">this study</a>.</p>',
    )
    expect(md).toBe(
      'Retrieval practice beats _re-reading_, per [this study](https://example.com/study).',
    )
  })
})
