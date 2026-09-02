import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MermaidView } from './mermaid-view'

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (_id: string, chart: string) => {
      if (chart.includes('invalid')) throw new Error('Parse error')
      return { svg: `<svg data-testid="mermaid-svg"><text>${chart}</text></svg>` }
    }),
  },
}))

describe('MermaidView', () => {
  it('renders the diagram as a sandboxed, script-free iframe', async () => {
    render(<MermaidView chart="graph TD; A-->B;" />)
    await waitFor(() => {
      expect(screen.getByTitle('Diagram')).toBeInTheDocument()
    })
    const iframe = screen.getByTitle('Diagram')
    expect(iframe).toHaveAttribute('sandbox', '')
    expect(iframe.getAttribute('srcdoc')).toContain('A-->B')
  })

  it('shows an error state when the diagram fails to render', async () => {
    render(<MermaidView chart="invalid diagram" errorLabel="Could not render this diagram." />)
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Could not render this diagram.')
    })
  })
})
