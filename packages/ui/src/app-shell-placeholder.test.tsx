import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppShellPlaceholder } from './index'

describe('AppShellPlaceholder', () => {
  it('renders the given title', () => {
    render(<AppShellPlaceholder title="Retenia" />)
    expect(screen.getByRole('heading', { name: 'Retenia' })).toBeInTheDocument()
  })
})
