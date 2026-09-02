import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CostBadge } from './cost-badge'

describe('CostBadge', () => {
  it('renders an approximate USD amount', () => {
    render(<CostBadge amountUsd={0.12} />)
    expect(screen.getByText('≈ USD 0.12')).toBeInTheDocument()
  })

  it('respects the decimals prop', () => {
    render(<CostBadge amountUsd={0.1234} decimals={4} />)
    expect(screen.getByText('≈ USD 0.1234')).toBeInTheDocument()
  })

  it('still renders the amount when a breakdown is given', () => {
    render(<CostBadge amountUsd={0.47} breakdown={[{ label: 'Extraction', amountUsd: 0.47 }]} />)
    expect(screen.getByText('≈ USD 0.47')).toBeInTheDocument()
  })
})
