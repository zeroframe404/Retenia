import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Mascot, type MascotHandle } from './mascot'

vi.mock('@rive-app/react-canvas', () => ({
  useRive: () => ({ rive: undefined, RiveComponent: () => <div data-testid="rive-canvas" /> }),
  useStateMachineInput: () => undefined,
}))

describe('Mascot', () => {
  it('is decorative (aria-hidden) with no label', () => {
    render(<Mascot />)
    expect(screen.getByTestId('mascot')).toHaveAttribute('aria-hidden', 'true')
  })

  it('exposes an accessible label when given one', () => {
    render(<Mascot label="Study buddy" />)
    expect(screen.getByRole('img', { name: 'Study buddy' })).toBeInTheDocument()
  })

  it('reflects the current mood', () => {
    render(<Mascot mood="celebrate" />)
    expect(screen.getByTestId('mascot')).toHaveAttribute('data-mood', 'celebrate')
  })

  it('renders the built-in placeholder shape without a src', () => {
    render(<Mascot />)
    expect(screen.queryByTestId('rive-canvas')).not.toBeInTheDocument()
  })

  it('renders the Rive-backed canvas when given a src', () => {
    render(<Mascot src="mascot.riv" />)
    expect(screen.getByTestId('rive-canvas')).toBeInTheDocument()
  })

  it('reacts to an imperative react() call without throwing', () => {
    const ref = createRef<MascotHandle>()
    render(<Mascot ref={ref} />)
    expect(() => ref.current?.react('correct')).not.toThrow()
  })
})
