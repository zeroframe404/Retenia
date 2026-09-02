import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SplitPane } from './split-pane'

describe('SplitPane', () => {
  it('renders both panes', () => {
    render(<SplitPane aria-label="Resize" start={<div>Start</div>} end={<div>End</div>} />)
    expect(screen.getByText('Start')).toBeInTheDocument()
    expect(screen.getByText('End')).toBeInTheDocument()
  })

  it('exposes the handle as an accessible separator at the default size', () => {
    render(
      <SplitPane
        aria-label="Resize"
        start={<div>Start</div>}
        end={<div>End</div>}
        defaultSize={40}
      />,
    )
    const handle = screen.getByRole('separator')
    expect(handle).toHaveAttribute('aria-valuenow', '40')
  })

  it('resizes with arrow keys, clamped to min/max', () => {
    render(
      <SplitPane
        aria-label="Resize"
        start={<div>Start</div>}
        end={<div>End</div>}
        defaultSize={50}
        minSize={20}
        maxSize={80}
      />,
    )
    const handle = screen.getByRole('separator')
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(handle).toHaveAttribute('aria-valuenow', '52')

    for (let i = 0; i < 20; i++) {
      fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    }
    expect(handle).toHaveAttribute('aria-valuenow', '20')
  })
})
