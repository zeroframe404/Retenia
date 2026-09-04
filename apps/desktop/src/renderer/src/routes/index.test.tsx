import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import '../i18n'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
}))
vi.mock('../features/review', () => ({
  TodayCard: () => <div data-testid="today-card-stub" />,
}))

const { HomeScreen } = await import('./index')

describe('HomeScreen', () => {
  it('renders the page title and the Today card', () => {
    render(<HomeScreen />)
    expect(screen.getByTestId('screen-home')).toHaveTextContent('Hoy')
    expect(screen.getByTestId('today-card-stub')).toBeInTheDocument()
  })
})
