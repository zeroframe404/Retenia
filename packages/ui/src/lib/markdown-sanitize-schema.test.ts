import { render } from '@testing-library/react'
import { fromHtmlIsomorphic } from 'hast-util-from-html-isomorphic'
import { defaultSchema } from 'rehype-sanitize'
import { describe, expect, it } from 'vitest'
import { markdownSanitizeSchema, renderSanitizedHast } from './markdown-sanitize-schema'

/** The MathML and SVG elements KaTeX's own renderer emits — the only tags this schema adds. */
const ADDED_TAGS = [
  'annotation',
  'line',
  'math',
  'menclose',
  'mfrac',
  'mi',
  'mn',
  'mo',
  'mover',
  'mpadded',
  'mphantom',
  'mroot',
  'mrow',
  'mspace',
  'msqrt',
  'mstyle',
  'msub',
  'msubsup',
  'msup',
  'mtable',
  'mtd',
  'mtext',
  'mtr',
  'munder',
  'munderover',
  'path',
  'semantics',
  'svg',
]

/** Tags that gain an attribute rule: the ones above, plus the two HTML elements KaTeX and
 * Shiki decorate (`span` for both, `pre` for Shiki's wrapper). */
const ADDED_ATTRIBUTE_TAGS = [...ADDED_TAGS, 'pre', 'span']

/** Sanitize a fragment of untrusted markup and put the result in the DOM the way the
 * components do — through `renderSanitizedHast`, never through `innerHTML`. */
function renderHtml(html: string) {
  return render(renderSanitizedHast(fromHtmlIsomorphic(html, { fragment: true })))
}

describe('markdownSanitizeSchema', () => {
  describe('diff against defaultSchema', () => {
    it('adds exactly the tags KaTeX emits, and removes none', () => {
      const before = new Set(defaultSchema.tagNames ?? [])
      const after = new Set(markdownSanitizeSchema.tagNames ?? [])

      expect([...after].filter((tag) => !before.has(tag)).sort()).toEqual(ADDED_TAGS)
      expect([...before].filter((tag) => !after.has(tag))).toEqual([])
    })

    it('leaves every attribute rule defaultSchema already had exactly as it was', () => {
      // This is the regression guard for `'*': [..., 'className', 'style']`: a `'*'` entry
      // is consulted for any key a tag-specific list rejects, so widening it silently voids
      // `code`'s `/^language-./`, `li`'s `task-list-item`, `ol`/`ul`'s `contains-task-list`,
      // `h2`'s `sr-only` and `section`'s `footnotes`.
      for (const [tag, rules] of Object.entries(defaultSchema.attributes ?? {})) {
        expect(markdownSanitizeSchema.attributes?.[tag]).toEqual(rules)
      }
    })

    it('adds attribute rules only for the tags KaTeX and Shiki decorate', () => {
      const before = defaultSchema.attributes ?? {}
      const added = Object.keys(markdownSanitizeSchema.attributes ?? {}).filter(
        (tag) => !(tag in before),
      )

      expect(added.sort()).toEqual([...ADDED_ATTRIBUTE_TAGS].sort())
    })

    it('narrows src to the app-owned scheme and leaves the other protocol lists alone', () => {
      // Narrower than `defaultSchema`'s `['http', 'https']` in both directions: the remote
      // schemes go, and no local one is added in exchange.
      expect(markdownSanitizeSchema.protocols?.src).toEqual(['media'])
      for (const key of ['cite', 'href', 'longDesc']) {
        expect(markdownSanitizeSchema.protocols?.[key]).toEqual(defaultSchema.protocols?.[key])
      }
    })

    it('changes nothing else', () => {
      expect(markdownSanitizeSchema.ancestors).toEqual(defaultSchema.ancestors)
      expect(markdownSanitizeSchema.clobber).toEqual(defaultSchema.clobber)
      expect(markdownSanitizeSchema.clobberPrefix).toEqual(defaultSchema.clobberPrefix)
      expect(markdownSanitizeSchema.required).toEqual(defaultSchema.required)
      expect(markdownSanitizeSchema.strip).toEqual(['script', 'style'])
    })
  })

  describe('mXSS payloads', () => {
    it('drops the text/html annotation encoding that smuggles markup into MathML', () => {
      const { container } = renderHtml(
        '<math><annotation encoding="text/html"><img src=x onerror=alert(1)></annotation></math>',
      )

      expect(container.innerHTML).not.toContain('text/html')
      expect(container.innerHTML).not.toContain('onerror')
    })

    it('drops an <svg><style> block whole instead of unwrapping it', () => {
      const { container } = renderHtml('<svg><style><img src=x onerror=alert(1)></style></svg>')

      expect(container.querySelector('style')).toBeNull()
      expect(container.innerHTML).not.toContain('onerror')
    })
  })

  describe('URLs', () => {
    it.each([
      ['javascript:alert(1)', 'javascript'],
      ['JaVaScRiPt&#58;alert(1)', 'a mixed-case scheme written as a character reference'],
      ['data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==', 'data:text/html'],
      ['vbscript:msgbox', 'vbscript'],
      ['&#10;javascript:alert(1)', 'a scheme behind leading whitespace'],
    ])('drops an href using %s', (href) => {
      const { container } = renderHtml(`<a href="${href}">x</a>`)
      expect(container.querySelector('a')?.hasAttribute('href')).toBe(false)
    })

    it('keeps a protocol-relative href, which is same-origin here, not remote', () => {
      // `hast-util-sanitize` only checks the scheme of URLs that have one; `//host` has
      // none, so it stays and resolves against the renderer's own `app://` origin. Stopping
      // it from going anywhere is the main process's navigation guard, not the sanitizer's.
      const { container } = renderHtml('<a href="//attacker.example">x</a>')
      expect(container.querySelector('a')).toHaveAttribute('href', '//attacker.example')
    })

    it('drops a remote image source and keeps a media:// one', () => {
      const remote = renderHtml('<img alt="" src="https://attacker.example/px.gif">')
      expect(remote.container.querySelector('img')?.hasAttribute('src')).toBe(false)

      const local = renderHtml('<img alt="" src="media://blob/abc123">')
      expect(local.container.querySelector('img')).toHaveAttribute('src', 'media://blob/abc123')
    })

    it.each([
      ['data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E'],
      ['blob:app://retenia/6f2a'],
    ])('drops an image source using %s, which img-src would otherwise render', (src) => {
      // `img-src` allows both, and `defaultResolveMedia` (`packages/activities`) refuses both for
      // a `MediaRef`. The sanitizer has to agree: an inline `data:` SVG in AI-generated markdown
      // is attacker-authored markup in this origin, and nothing mints object URLs for Markdown.
      const { container } = renderHtml(`<img alt="" src="${src}">`)
      expect(container.querySelector('img')?.hasAttribute('src')).toBe(false)
    })
  })

  describe('inert markup', () => {
    it.each([
      ['<img src=x onerror=alert(1)>', 'onerror'],
      ['<svg onload=alert(1)></svg>', 'onload'],
      ['<body onload=alert(1)>text</body>', 'onload'],
    ])('strips the event handler in %s', (html, attribute) => {
      const { container } = renderHtml(html)
      expect(container.querySelector(`[${attribute}]`)).toBeNull()
      expect(container.innerHTML).not.toContain(attribute)
    })

    it.each([
      ['<iframe src="javascript:alert(1)"></iframe>', 'iframe'],
      ['<base href="//evil.example">', 'base'],
      ['<form action="https://attacker.example"><input></form>', 'form'],
      ['<script>window.__pwned = true</script>', 'script'],
    ])('removes %s from the tree', (html, tagName) => {
      const { container } = renderHtml(html)
      expect(container.querySelector(tagName)).toBeNull()
      expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined()
    })
  })

  describe('inline styles', () => {
    it.each([
      'color:#ff0000',
      'height:0.4306em;vertical-align:-0.34em;',
      'color:#D73A49;--shiki-dark:#F97583',
      'border:0.04em solid blue',
    ])('keeps the declaration list %s', (style) => {
      const { container } = renderHtml(`<span style="${style}">x</span>`)
      expect(container.querySelector('span')?.getAttribute('style')).not.toBe('')
    })

    it.each([
      ['background:url(https://attacker.example/px.png)', 'reaches the network'],
      ['a:b;;{', 'is malformed enough to throw inside style-to-js'],
      ['color:expression(alert(1))', 'calls a function'],
    ])('drops a style that %s', (style) => {
      const { container } = renderHtml(`<span style="${style}">x</span>`)
      expect(container.querySelector('span')?.hasAttribute('style')).toBe(false)
    })
  })

  describe('renderSanitizedHast', () => {
    it('renders a style attribute as a React style object, not as parsed markup', () => {
      // The distinction the renderer's CSP cares about: a `style` that arrives through
      // `innerHTML` is parsed markup and `style-src 'self'` drops it, while one React
      // applies goes through CSSOM and survives.
      const { container } = renderHtml('<span style="height:0.4306em">x</span>')
      expect(container.querySelector('span')?.style.height).toBe('0.4306em')
    })

    it('keeps text that looks like markup as text', () => {
      const { container } = renderHtml(
        '<pre><code>&lt;script&gt;alert(1)&lt;/script&gt;</code></pre>',
      )
      expect(container.querySelector('script')).toBeNull()
      expect(container.textContent).toBe('<script>alert(1)</script>')
    })
  })
})
