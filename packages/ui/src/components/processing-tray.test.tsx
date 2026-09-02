import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProcessingTray } from './processing-tray'

describe('ProcessingTray', () => {
  it('shows the empty state when there are no jobs', () => {
    render(
      <ProcessingTray
        jobs={[]}
        collapsed={false}
        onToggleCollapsed={() => {}}
        title="Processing"
        emptyState="No background jobs"
        collapseLabel="Collapse"
        expandLabel="Expand"
      />,
    )
    expect(screen.getByText('No background jobs')).toBeInTheDocument()
    expect(screen.queryByTestId('processing-tray-count')).not.toBeInTheDocument()
  })

  it('lists jobs and shows a count badge', () => {
    render(
      <ProcessingTray
        jobs={[
          { id: '1', label: 'Ingesting a PDF', progress: 50 },
          { id: '2', label: 'Generating embeddings' },
        ]}
        collapsed={false}
        onToggleCollapsed={() => {}}
        title="Processing"
        emptyState="No background jobs"
        collapseLabel="Collapse"
        expandLabel="Expand"
      />,
    )
    expect(screen.getByTestId('processing-tray-count')).toHaveTextContent('2')
    expect(screen.getByText('Ingesting a PDF')).toBeInTheDocument()
    expect(screen.getByText('Generating embeddings')).toBeInTheDocument()
  })

  it('hides the job list while collapsed but keeps the header', () => {
    render(
      <ProcessingTray
        jobs={[{ id: '1', label: 'Ingesting a PDF' }]}
        collapsed
        onToggleCollapsed={() => {}}
        title="Processing"
        emptyState="No background jobs"
        collapseLabel="Collapse"
        expandLabel="Expand"
      />,
    )
    expect(screen.getByText('Processing')).toBeInTheDocument()
    expect(screen.queryByText('Ingesting a PDF')).not.toBeInTheDocument()
  })

  it('calls onToggleCollapsed when the toggle is clicked', () => {
    const onToggleCollapsed = vi.fn()
    render(
      <ProcessingTray
        jobs={[]}
        collapsed={false}
        onToggleCollapsed={onToggleCollapsed}
        title="Processing"
        emptyState="No background jobs"
        collapseLabel="Collapse"
        expandLabel="Expand"
      />,
    )
    fireEvent.click(screen.getByTestId('processing-tray-toggle'))
    expect(onToggleCollapsed).toHaveBeenCalledOnce()
  })
})
