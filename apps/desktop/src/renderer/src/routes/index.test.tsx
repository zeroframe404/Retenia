import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n'

const navigate = vi.fn()
let dueCount = 0

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
  useNavigate: () => navigate,
}))
vi.mock('../shell/use-due-count', () => ({ useDueCount: () => dueCount }))

const { HomeScreen } = await import('./index')

describe('HomeScreen', () => {
  beforeEach(() => {
    navigate.mockClear()
    dueCount = 0
  })

  it('offers exactly one primary action (docs/spec/08-ux.md §1.1)', () => {
    dueCount = 12
    render(<HomeScreen />)
    // The literal encoding of "one primary action per screen": if a future change drops a
    // second button onto Today, this fails.
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByTestId('home-primary-action')).toHaveTextContent('Empezar a repasar')
  })

  it('summarizes the real due count and enables the action', async () => {
    dueCount = 12
    render(<HomeScreen />)
    expect(screen.getByTestId('home-summary')).toHaveTextContent('12 tarjetas pendientes')

    await userEvent.click(screen.getByTestId('home-primary-action'))
    expect(navigate).toHaveBeenCalledWith({ to: '/review' })
  })

  it('disables the action and says so when nothing is due, rather than inventing a count', () => {
    render(<HomeScreen />)
    expect(screen.getByTestId('home-primary-action')).toBeDisabled()
    expect(screen.getByTestId('home-summary')).toHaveTextContent('No hay nada pendiente')
    expect(navigate).not.toHaveBeenCalled()
  })
})
