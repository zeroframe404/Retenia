import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { type ProcessingJob, ProcessingTray, type ProcessingTrayProps } from './processing-tray'

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

  it('lists jobs and shows a count badge with the full sentence as its accessible name', () => {
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
        jobCountLabel="2 jobs running"
      />,
    )
    expect(screen.getByTestId('processing-tray-count')).toHaveTextContent('2')
    expect(screen.getByTestId('processing-tray-count')).toHaveAttribute(
      'aria-label',
      '2 jobs running',
    )
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

  // docs/spec/08-ux.md §1.6: "long operations live in a progress panel with cancel/resume".
  // Resume has no counterpart in the queue (`jobs` has no `paused` status), so the controls
  // the tray actually offers are cancel and, for a failure, retry.
  describe('per-job controls', () => {
    const jobs: ProcessingJob[] = [
      { id: 'a', label: 'Ingesting a PDF', progress: 42 },
      { id: 'b', label: 'Transcribing a video', status: 'failed', error: 'ffmpeg exited 1' },
      { id: 'c', label: 'Generating embeddings', status: 'queued' },
    ]

    function renderTray(overrides: Partial<ProcessingTrayProps> = {}) {
      return render(
        <ProcessingTray
          jobs={jobs}
          collapsed={false}
          onToggleCollapsed={() => {}}
          title="Processing"
          emptyState="No background jobs"
          collapseLabel="Collapse"
          expandLabel="Expand"
          cancelLabel="Cancel"
          retryLabel="Retry"
          queuedLabel="Queued"
          {...overrides}
        />,
      )
    }

    it('renders no controls when the host supplies no handlers', () => {
      renderTray()
      expect(screen.queryByTestId('processing-job-cancel-a')).not.toBeInTheDocument()
      expect(screen.queryByTestId('processing-job-retry-b')).not.toBeInTheDocument()
    })

    it('cancels the job the button belongs to', () => {
      const onCancelJob = vi.fn()
      renderTray({ onCancelJob })
      fireEvent.click(screen.getByTestId('processing-job-cancel-b'))
      expect(onCancelJob).toHaveBeenCalledExactlyOnceWith('b')
    })

    it('offers Retry only for a failed job — there is nothing to retry about a running one', () => {
      const onRetryJob = vi.fn()
      renderTray({ onRetryJob })

      expect(screen.getByTestId('processing-job-retry-b')).toBeInTheDocument()
      expect(screen.queryByTestId('processing-job-retry-a')).not.toBeInTheDocument()
      expect(screen.queryByTestId('processing-job-retry-c')).not.toBeInTheDocument()

      fireEvent.click(screen.getByTestId('processing-job-retry-b'))
      expect(onRetryJob).toHaveBeenCalledExactlyOnceWith('b')
    })

    it('shows why a job failed, with the untruncated text available on hover', () => {
      renderTray()
      const error = screen.getByTestId('processing-job-error-b')
      expect(error).toHaveTextContent('ffmpeg exited 1')
      expect(error).toHaveAttribute('title', 'ffmpeg exited 1')
    })

    it('shows an error only for the job that failed', () => {
      renderTray()
      expect(screen.queryByTestId('processing-job-error-a')).not.toBeInTheDocument()
    })

    it('labels a queued job instead of showing it a progress bar', () => {
      renderTray()
      expect(screen.getByText('Queued')).toBeInTheDocument()
      // One bar, for the one running job.
      expect(screen.getAllByRole('progressbar')).toHaveLength(1)
    })

    it('names the icon-only controls for assistive tech', () => {
      renderTray({ onCancelJob: vi.fn(), onRetryJob: vi.fn() })
      expect(screen.getByTestId('processing-job-cancel-a')).toHaveAccessibleName('Cancel')
      expect(screen.getByTestId('processing-job-retry-b')).toHaveAccessibleName('Retry')
    })
  })
})
