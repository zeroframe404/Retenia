import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { IMPORTANCE_LEVELS, ImportanceBadge } from './importance-badge'

describe('ImportanceBadge', () => {
  it('renders the default label for each level', () => {
    for (const level of IMPORTANCE_LEVELS) {
      const { unmount } = render(<ImportanceBadge level={level} />)
      expect(screen.getByText(new RegExp(`^${level}$`, 'i'))).toBeInTheDocument()
      unmount()
    }
  })

  it('renders a custom label when given', () => {
    render(<ImportanceBadge level="urgent" label="Urgente" />)
    expect(screen.getByText('Urgente')).toBeInTheDocument()
  })
})
