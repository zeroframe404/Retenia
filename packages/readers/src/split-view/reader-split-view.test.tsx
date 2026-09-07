import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ReaderSplitView } from './reader-split-view'

describe('ReaderSplitView', () => {
  afterEach(() => window.localStorage.clear())

  it('renders the reader and the panel side by side', () => {
    render(
      <ReaderSplitView
        reader={<div>Reader content</div>}
        panel={<div>Notes panel</div>}
        panelLabel="Resize reader/notes split"
      />,
    )
    expect(screen.getByText('Reader content')).toBeInTheDocument()
    expect(screen.getByText('Notes panel')).toBeInTheDocument()
  })

  it('persists the split ratio across a remount, under its storage key', () => {
    const props = {
      reader: <div>Reader</div>,
      panel: <div>Panel</div>,
      panelLabel: 'Resize',
      storageKey: 'test.reader-split',
    }
    const { unmount } = render(<ReaderSplitView {...props} />)
    const handle = screen.getByRole('separator')
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    const resized = handle.getAttribute('aria-valuenow')
    unmount()

    render(<ReaderSplitView {...props} />)
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', resized)
  })

  it('keeps independent readers on different storage keys separate', () => {
    render(
      <ReaderSplitView
        reader={<div>A</div>}
        panel={<div>A panel</div>}
        panelLabel="Resize A"
        storageKey="test.a"
      />,
    )
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize A' }), { key: 'ArrowRight' })

    render(
      <ReaderSplitView
        reader={<div>B</div>}
        panel={<div>B panel</div>}
        panelLabel="Resize B"
        storageKey="test.b"
      />,
    )
    const bHandle = screen.getByRole('separator', { name: 'Resize B' })
    expect(bHandle).toHaveAttribute('aria-valuenow', '65')
  })
})
