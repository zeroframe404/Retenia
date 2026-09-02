import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CodeBlock } from './code-block'

describe('CodeBlock', () => {
  beforeEach(() => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
  })

  it('renders the raw code immediately, then Shiki-highlighted markup once ready', async () => {
    const { container } = render(<CodeBlock code="const x = 1" language="typescript" />)
    expect(screen.getByText('const x = 1')).toBeInTheDocument()

    await waitFor(() => {
      expect(container.querySelector('.shiki')).not.toBeNull()
    })
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
})
