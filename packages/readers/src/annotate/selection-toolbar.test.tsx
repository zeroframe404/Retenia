import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SelectionToolbar } from './selection-toolbar'

const labels = {
  highlight: 'Resaltar',
  createCard: 'Crear tarjeta',
  askAi: 'Preguntar a la IA',
  copyWithCitation: 'Copiar con cita',
}

describe('SelectionToolbar', () => {
  it('renders the three always-on actions and calls back on click', async () => {
    const user = userEvent.setup()
    const onHighlight = vi.fn()
    const onCreateCard = vi.fn()
    const onCopyWithCitation = vi.fn()
    render(
      <SelectionToolbar
        labels={labels}
        position={{ x: 100, y: 200 }}
        onHighlight={onHighlight}
        onCreateCard={onCreateCard}
        onCopyWithCitation={onCopyWithCitation}
      />,
    )

    await user.click(screen.getByRole('button', { name: labels.highlight }))
    await user.click(screen.getByRole('button', { name: labels.createCard }))
    await user.click(screen.getByRole('button', { name: labels.copyWithCitation }))

    expect(onHighlight).toHaveBeenCalledTimes(1)
    expect(onCreateCard).toHaveBeenCalledTimes(1)
    expect(onCopyWithCitation).toHaveBeenCalledTimes(1)
  })

  it('hides "Preguntar a la IA" when no handler is given, and shows it when one is', () => {
    const { rerender } = render(
      <SelectionToolbar
        labels={labels}
        position={{ x: 0, y: 0 }}
        onHighlight={vi.fn()}
        onCreateCard={vi.fn()}
        onCopyWithCitation={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: labels.askAi })).not.toBeInTheDocument()

    rerender(
      <SelectionToolbar
        labels={labels}
        position={{ x: 0, y: 0 }}
        onHighlight={vi.fn()}
        onCreateCard={vi.fn()}
        onCopyWithCitation={vi.fn()}
        onAskAi={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: labels.askAi })).toBeInTheDocument()
  })

  it('positions itself at the given viewport coordinates', () => {
    render(
      <SelectionToolbar
        labels={labels}
        position={{ x: 150, y: 75 }}
        onHighlight={vi.fn()}
        onCreateCard={vi.fn()}
        onCopyWithCitation={vi.fn()}
      />,
    )
    const toolbar = screen.getByRole('toolbar')
    expect(toolbar).toHaveStyle({ left: '150px', top: '75px' })
  })
})
