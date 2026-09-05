import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { KatexInline } from './katex-inline'
import { MarkdownView } from './markdown-view'

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (_id: string, chart: string) => ({
      svg: `<svg data-testid="mermaid-svg"><text>${chart}</text></svg>`,
    })),
  },
}))

describe('MarkdownView', () => {
  it('renders headings and prose', () => {
    render(<MarkdownView>{'# Title\n\nSome text.'}</MarkdownView>)
    expect(screen.getByRole('heading', { level: 1, name: 'Title' })).toBeInTheDocument()
    expect(screen.getByText('Some text.')).toBeInTheDocument()
  })

  it('renders a GFM table and task list', () => {
    render(
      <MarkdownView>
        {'| A | B |\n| --- | --- |\n| 1 | 2 |\n\n- [x] Done\n- [ ] Todo'}
      </MarkdownView>,
    )
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  })

  it('renders inline math via KaTeX', () => {
    const { container } = render(<MarkdownView>{'Energy: $E = mc^2$'}</MarkdownView>)
    expect(container.querySelector('.katex')).not.toBeNull()
  })

  it('renders inline code without going through CodeBlock', () => {
    render(<MarkdownView>{'Call `foo()` now.'}</MarkdownView>)
    expect(screen.getByText('foo()').tagName).toBe('CODE')
  })

  it('highlights fenced code via CodeBlock', async () => {
    const { container } = render(<MarkdownView>{'```typescript\nconst x = 1\n```'}</MarkdownView>)
    await waitFor(() => {
      expect(container.querySelector('.shiki')).not.toBeNull()
    })
  })

  it('routes ```mermaid fences to MermaidView instead of CodeBlock', async () => {
    render(<MarkdownView>{'```mermaid\ngraph TD; A-->B;\n```'}</MarkdownView>)
    await waitFor(() => {
      // `MermaidView` presents the diagram as an image of a `data:` SVG, not as markup.
      expect(screen.getByAltText('Diagram')).toBeInTheDocument()
    })
  })

  it('does not render raw HTML from the source as markup', () => {
    const { container } = render(
      <MarkdownView>{'<script>window.__pwned = true</script>'}</MarkdownView>,
    )
    expect(container.querySelector('script')).toBeNull()
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined()
  })

  describe('link destinations', () => {
    it.each([
      ['[x](javascript:alert(1))', 'javascript'],
      ['[x](JaVaScRiPt&#58;alert(1))', 'a mixed-case scheme written as a character reference'],
      ['[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)', 'data:text/html'],
      ['[x](vbscript:msgbox)', 'vbscript'],
      ['[x](&#10;javascript:alert(1))', 'a scheme behind leading whitespace'],
    ])('renders %s without an href', (markdown) => {
      const { container } = render(<MarkdownView>{markdown}</MarkdownView>)
      expect(container.querySelector('a')?.hasAttribute('href')).toBe(false)
    })

    it('keeps a protocol-relative destination, which is same-origin here', () => {
      // No scheme means nothing for the sanitizer to reject; `//host` resolves against the
      // renderer's own `app://` origin, and the main process's navigation guard — not this
      // schema — is what stops it going anywhere.
      const { container } = render(<MarkdownView>{'[x](//attacker.example)'}</MarkdownView>)
      expect(container.querySelector('a')).toHaveAttribute('href', '//attacker.example')
    })
  })

  describe('image sources', () => {
    it('drops a remote image source', () => {
      const { container } = render(
        <MarkdownView>{'![](https://attacker.example/px.gif)'}</MarkdownView>,
      )
      expect(container.querySelector('img')?.hasAttribute('src')).toBe(false)
    })

    it('keeps a media:// image source', () => {
      const { container } = render(<MarkdownView>{'![](media://blob/abc123)'}</MarkdownView>)
      expect(container.querySelector('img')).toHaveAttribute('src', 'media://blob/abc123')
    })
  })

  describe('raw HTML in the source', () => {
    it.each([
      ['<img src=x onerror=alert(1)>', 'img'],
      ['<svg onload=alert(1)></svg>', 'svg'],
      ['<iframe src=javascript:alert(1)></iframe>', 'iframe'],
      ['<base href=//evil.example>', 'base'],
      ['<form action="https://attacker.example"><input></form>', 'form'],
    ])('never turns %s into a live <%s>', (markdown, tagName) => {
      const { container } = render(<MarkdownView>{markdown}</MarkdownView>)
      expect(container.querySelector(tagName)).toBeNull()
      expect(container.querySelector('[onerror], [onload]')).toBeNull()
    })
  })

  describe('math', () => {
    it('does not honour \\href inside math, because trust stays false', () => {
      const { container } = render(
        <MarkdownView>{'Link: $\\href{javascript:alert(1)}{x}$'}</MarkdownView>,
      )
      expect(container.querySelector('a')).toBeNull()
      expect(container.querySelector('[href]')).toBeNull()
    })

    it('bounds a user-specified length with maxSize', () => {
      const { container } = render(<MarkdownView>{'$$\\rule{100000em}{100000em}$$'}</MarkdownView>)
      expect(container.querySelector('mspace[width]')?.getAttribute('width')).toBe('25em')
    })

    it('returns an error instead of looping on a self-referential macro', () => {
      const { container } = render(<MarkdownView>{'$\\def\\a{\\a}\\a$'}</MarkdownView>)
      expect(container.querySelector('.katex-error')).not.toBeNull()
    })

    // `rehype-katex` depends on `katex@^0.16` and this package on `katex@0.18.5`, so without the
    // `overrides` entry in `pnpm-workspace.yaml` the two paths run different KaTeX majors: prose
    // math would emit 0.16's `base`/`strut`/`mord` class names while the only stylesheet shipped
    // is 0.18.5's, which renames them to `katex-base`/`katex-strut` and defines nothing for the
    // old ones. The rendering keeps working, so only the class vocabulary can catch it.
    it('renders prose math with the same KaTeX build as KatexInline, so one stylesheet fits both', () => {
      const classesOf = (root: Element | null): string[] => {
        if (root === null) return []
        const seen = new Set<string>()
        for (const element of [root, ...root.querySelectorAll('*')]) {
          for (const name of element.classList) seen.add(name)
        }
        return [...seen].sort()
      }

      const prose = render(<MarkdownView>{'Rate: $\\frac{a}{b}$'}</MarkdownView>)
      const standalone = render(<KatexInline math={'\\frac{a}{b}'} />)

      const proseClasses = classesOf(prose.container.querySelector('.katex'))
      expect(proseClasses).toContain('katex-html')
      expect(proseClasses).toEqual(classesOf(standalone.container.querySelector('.katex')))
    })
  })

  describe('inline mode', () => {
    it('renders phrasing content only, so it can live inside a button or a label', () => {
      const { container } = render(<MarkdownView inline>**She** goes</MarkdownView>)

      // No `<p>` and no `<div>`: both are invalid inside a `<button>`, which is what the
      // activity token bank puts this in.
      expect(container.querySelector('p')).toBeNull()
      expect(container.querySelector('div')).toBeNull()
      expect(container.firstElementChild?.tagName).toBe('SPAN')
      expect(container.querySelector('strong')).toHaveTextContent('She')
    })

    it('formats the same source the block mode does, rather than showing it as text', () => {
      const { container } = render(<MarkdownView inline>{'$H_2O$'}</MarkdownView>)

      expect(container.querySelector('.katex')).not.toBeNull()
      expect(container.textContent).not.toContain('$H_2O$')
    })
  })
})
