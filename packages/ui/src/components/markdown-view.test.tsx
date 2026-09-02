import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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
      expect(screen.getByTitle('Diagram')).toBeInTheDocument()
    })
  })

  it('does not render raw HTML from the source as markup', () => {
    const { container } = render(
      <MarkdownView>{'<script>window.__pwned = true</script>'}</MarkdownView>,
    )
    expect(container.querySelector('script')).toBeNull()
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined()
  })
})
