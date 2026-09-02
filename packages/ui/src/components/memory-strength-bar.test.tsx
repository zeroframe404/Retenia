import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryStrengthBar } from './memory-strength-bar'

describe('MemoryStrengthBar', () => {
  it('renders the percentage and exposes it via progressbar semantics', () => {
    render(<MemoryStrengthBar retrievability={0.71} />)
    expect(screen.getByText('71%')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '71')
  })

  it('clamps out-of-range values', () => {
    render(<MemoryStrengthBar retrievability={1.5} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
  })

  it('labels the correct band per bucket', () => {
    const { rerender } = render(<MemoryStrengthBar retrievability={0.1} />)
    expect(screen.getByText('Critical')).toBeInTheDocument()

    rerender(<MemoryStrengthBar retrievability={0.5} />)
    expect(screen.getByText('Weak')).toBeInTheDocument()

    rerender(<MemoryStrengthBar retrievability={0.7} />)
    expect(screen.getByText('Good')).toBeInTheDocument()

    rerender(<MemoryStrengthBar retrievability={0.95} />)
    expect(screen.getByText('Strong')).toBeInTheDocument()
  })

  it('hides the band label when hideBand is set', () => {
    render(<MemoryStrengthBar retrievability={0.7} hideBand />)
    expect(screen.queryByText('Good')).not.toBeInTheDocument()
  })
})
