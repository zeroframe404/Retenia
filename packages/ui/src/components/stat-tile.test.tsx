import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatTile } from './stat-tile'

describe('StatTile', () => {
  it('renders the value and label', () => {
    render(<StatTile value="1,240" label="XP this week" />)
    expect(screen.getByText('1,240')).toBeInTheDocument()
    expect(screen.getByText('XP this week')).toBeInTheDocument()
  })

  it('formats a positive delta with a leading plus', () => {
    render(<StatTile value="87%" label="Retention" delta={4.2} />)
    expect(screen.getByText('+4.2')).toBeInTheDocument()
  })

  it('formats a negative delta without double signs', () => {
    render(<StatTile value="32" label="Overdue" delta={-8} />)
    expect(screen.getByText('-8')).toBeInTheDocument()
  })

  it('omits the delta row when delta is not given', () => {
    render(<StatTile value="6" label="Streak" />)
    expect(screen.queryByText(/^[+-]/)).not.toBeInTheDocument()
  })

  it('renders a custom-formatted delta', () => {
    render(<StatTile value="6" label="Streak" delta={3} formatDelta={(d) => `${d} days`} />)
    expect(screen.getByText('3 days')).toBeInTheDocument()
  })
})
