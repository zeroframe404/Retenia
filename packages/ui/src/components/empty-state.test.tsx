import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EmptyState } from './empty-state'

describe('EmptyState', () => {
  it('renders the title', () => {
    render(<EmptyState title="No sources yet" />)
    expect(screen.getByText('No sources yet')).toBeInTheDocument()
  })

  it('renders description and action when given', () => {
    render(
      <EmptyState
        title="No sources yet"
        description="Add a PDF to get started."
        action={<button type="button">Add source</button>}
      />,
    )
    expect(screen.getByText('Add a PDF to get started.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add source' })).toBeInTheDocument()
  })
})
