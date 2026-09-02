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

  // WCAG 2.2 SC 2.5.8 Target Size (Minimum). Asserted on the utility class rather than a
  // measured box: jsdom applies no Tailwind stylesheet, so every element measures 0x0 here.
  it.each([
    ['horizontal', 'w-6'],
    ['vertical', 'h-6'],
  ] as const)('gives the %s handle a 24px grab target', (direction, sizeClass) => {
    render(
      <SplitPane
        aria-label="Resize"
        direction={direction}
        start={<div>Start</div>}
        end={<div>End</div>}
      />,
    )
    const handle = screen.getByRole('separator')
    expect(handle).toHaveClass(sizeClass)
    // The hairline is the pseudo-element, so the 1px rule must not size the element itself.
    expect(handle.className).not.toMatch(/(^|\s)[wh]-px(\s|$)/)
  })
})
