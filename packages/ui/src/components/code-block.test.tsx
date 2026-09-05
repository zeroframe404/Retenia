import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CodeBlock } from './code-block'

/** Resolve once Shiki has replaced the plain `<pre>` fallback with highlighted markup. */
async function highlighted(container: HTMLElement): Promise<HTMLElement> {
  await waitFor(() => {
    expect(container.querySelector('.shiki')).not.toBeNull()
  })
  return container.querySelector<HTMLElement>('.shiki') as HTMLElement
}

describe('CodeBlock', () => {
  beforeEach(() => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
  })

  it('renders the raw code immediately, then Shiki-highlighted markup once ready', async () => {
    const { container } = render(<CodeBlock code="const x = 1" language="typescript" />)
    expect(screen.getByText('const x = 1')).toBeInTheDocument()

    await highlighted(container)
  })

  it('shows the filename header when given', () => {
    render(<CodeBlock code="x" filename="scheduler.ts" />)
    expect(screen.getByText('scheduler.ts')).toBeInTheDocument()
  })

  it('copies the code to the clipboard and shows a confirmation', async () => {
    render(<CodeBlock code="const x = 1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('const x = 1')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
    })
  })

  it('applies Shiki token colors as inline styles, which survive the packaged CSP', async () => {
    // Shiki's dual-theme output carries both palettes as inline custom properties, which
    // `theme.css`'s `[data-theme="dark"] .shiki` override reads. Rendered through React
    // they are CSSOM writes, so `style-src` does not drop them (see `renderSanitizedHast`).
    const { container } = render(<CodeBlock code="const x = 1" language="typescript" />)
    const token = (await highlighted(container)).querySelector<HTMLElement>('span[style]')

    expect(token?.style.color).not.toBe('')
    expect(token?.style.getPropertyValue('--shiki-dark')).not.toBe('')
  })

  describe('untrusted code bodies', () => {
    it.each([
      ['<script>window.__pwned = true</script>', 'script'],
      ['<img src=x onerror=alert(1)>', 'img'],
      ['</pre></code><b>escaped</b>', 'b'],
      ['a <!-- b --> c -->', 'template'],
    ])('renders %s as text, not as markup', async (code, forbiddenTag) => {
      const { container } = render(<CodeBlock code={code} language="typescript" />)
      const block = await highlighted(container)

      expect(block.textContent).toBe(code)
      expect(container.querySelector(forbiddenTag)).toBeNull()
      expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined()
    })
  })

  describe('language resolution', () => {
    it('resolves a Shiki alias', async () => {
      const { container } = render(<CodeBlock code="const x = 1" language="ts" />)
      expect((await highlighted(container)).querySelector('span[style]')).not.toBeNull()
    })

    it('falls back to plaintext for an id Shiki does not bundle', async () => {
      // The id comes from a fence info string (```<script>) in content that can be
      // AI-generated: it is checked against the bundled grammar list before Shiki is asked
      // to load it, and it is never written into the DOM.
      const { container } = render(<CodeBlock code="const x = 1" language="<script>" />)
      const block = await highlighted(container)

      expect(block.textContent).toBe('const x = 1')
      expect(container.querySelector('script')).toBeNull()
      expect(container.innerHTML).not.toContain('script')
    })
  })
})
