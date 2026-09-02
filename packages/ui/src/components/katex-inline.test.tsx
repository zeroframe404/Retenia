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
    expect(() => render(<KatexInline math="\\frac{1" />)).not.toThrow()
  })
})
