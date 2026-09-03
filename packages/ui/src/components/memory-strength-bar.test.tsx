import { strengthBand } from '@retenia/core'
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

  // docs/spec/08-ux.md §1.3: "every card shows its strength (R), stability (S) and why it
  // appeared today".
  it('renders stability next to retrievability when supplied', () => {
    const { rerender } = render(<MemoryStrengthBar retrievability={0.71} stability={12.4} />)
    expect(screen.getByTestId('memory-strength-stability')).toHaveTextContent('12 d')

    // Sub-day stabilities are common right after a lapse and must not round to "0 d".
    rerender(<MemoryStrengthBar retrievability={0.4} stability={0.42} />)
    expect(screen.getByTestId('memory-strength-stability')).toHaveTextContent('0.4 d')
  })

  it('omits stability entirely when it is unknown', () => {
    render(<MemoryStrengthBar retrievability={0.71} />)
    expect(screen.queryByTestId('memory-strength-stability')).not.toBeInTheDocument()
  })

  it("lets the host format stability, since the unit word is i18n's", () => {
    render(<MemoryStrengthBar retrievability={0.71} stability={12} stabilityLabel="12 días" />)
    expect(screen.getByTestId('memory-strength-stability')).toHaveTextContent('12 días')
  })

  it('shows why the item came up today', () => {
    render(<MemoryStrengthBar retrievability={0.5} dueReason="Vence hoy · examen del 14" />)
    expect(screen.getByTestId('memory-strength-due-reason')).toHaveTextContent(
      'Vence hoy · examen del 14',
    )
  })

  it('accepts translated band words, so es-AR is not stuck with English', () => {
    const bandLabels = {
      critical: 'Crítica',
      weak: 'Débil',
      good: 'Buena',
      strong: 'Fuerte',
    } as const

    const { rerender } = render(<MemoryStrengthBar retrievability={0.1} bandLabels={bandLabels} />)
    expect(screen.getByText('Crítica')).toBeInTheDocument()
    expect(screen.queryByText('Critical')).not.toBeInTheDocument()

    rerender(<MemoryStrengthBar retrievability={0.95} bandLabels={bandLabels} />)
    expect(screen.getByText('Fuerte')).toBeInTheDocument()
  })
})

describe('band parity with the scheduler', () => {
  /**
   * The bar's colour and the band a scheduler query reports must never disagree: both come
   * from `@retenia/core`'s `strengthBand`, and this is the assertion that keeps the
   * component honest if someone reintroduces a local threshold table.
   */
  it.each([
    [0.2, 'Critical'],
    [0.3, 'Critical'],
    [0.5, 'Weak'],
    [0.6, 'Weak'],
    [0.7, 'Good'],
    [0.85, 'Good'],
    [0.9, 'Strong'],
  ])('paints R = %s as %s, exactly as core classifies it', (retrievability, label) => {
    render(<MemoryStrengthBar retrievability={retrievability} />)
    expect(strengthBand(retrievability)).toBe(label.toLowerCase())
    expect(screen.getByText(label)).toBeInTheDocument()
  })
})
