import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { KatexInline } from './katex-inline'

describe('KatexInline', () => {
  it('renders KaTeX markup for valid LaTeX', () => {
    const { container } = render(<KatexInline math="E = mc^2" />)
    expect(container.querySelector('.katex')).not.toBeNull()
  })

  it('renders as a display block when displayMode is set', () => {
    const { container } = render(<KatexInline math="x^2" displayMode />)
    expect(container.querySelector('.katex-display')).not.toBeNull()
  })

  it('does not throw on invalid LaTeX', () => {
    expect(() => render(<KatexInline math={'\\frac{1'} />)).not.toThrow()
  })

  it('applies KaTeX positioning as inline styles, which survive the packaged CSP', () => {
    // KaTeX lays math out entirely with inline `style`. Rendered through React those are
    // CSSOM writes, which `style-src` does not govern — the whole reason this component
    // does not use `dangerouslySetInnerHTML` (see `renderSanitizedHast`).
    const { container } = render(<KatexInline math={'\\frac{a}{b}'} />)
    const positioned = container.querySelector<HTMLElement>('.katex-html [style]')
    expect(positioned?.style.height).toMatch(/em$/)
  })

  it('does not honour \\href, because trust stays false', () => {
    const { container } = render(<KatexInline math={'\\href{javascript:alert(1)}{x}'} />)
    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelector('[href]')).toBeNull()
  })

  it('does not honour \\htmlData, because trust stays false', () => {
    const { container } = render(<KatexInline math={'\\htmlData{a=b}{x}'} />)
    expect(container.querySelector('[data-a]')).toBeNull()
    expect(container.innerHTML).not.toContain('data-a')
  })

  it('bounds a user-specified length with maxSize', () => {
    // KaTeX's own default is `maxSize: Infinity`, which lays out a 100000em box.
    const { container } = render(<KatexInline math={'\\rule{100000em}{100000em}'} />)
    expect(container.querySelector('mspace[width]')?.getAttribute('width')).toBe('25em')
  })

  it('returns an error instead of looping on a self-referential macro', () => {
    const { container } = render(<KatexInline math={'\\def\\a{\\a}\\a'} />)
    expect(container.querySelector('.katex-error')).not.toBeNull()
  })

  it('renders LaTeX that looks like HTML as text', () => {
    const { container } = render(<KatexInline math="<img src=x onerror=alert(1)>" />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[onerror]')).toBeNull()
  })
})
