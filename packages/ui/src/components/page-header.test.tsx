import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PageHeader } from './page-header'

describe('PageHeader', () => {
  it('renders the title', () => {
    render(<PageHeader title="Biology 101" />)
    expect(screen.getByRole('heading', { level: 1, name: 'Biology 101' })).toBeInTheDocument()
  })

  it('renders the subtitle only when given', () => {
    const { rerender } = render(<PageHeader title="Biology 101" />)
    expect(screen.queryByText('42 lessons')).not.toBeInTheDocument()

    rerender(<PageHeader title="Biology 101" subtitle="42 lessons" />)
    expect(screen.getByText('42 lessons')).toBeInTheDocument()
  })

  it('renders actions', () => {
    render(<PageHeader title="Biology 101" actions={<button type="button">Add source</button>} />)
    expect(screen.getByRole('button', { name: 'Add source' })).toBeInTheDocument()
  })
})
