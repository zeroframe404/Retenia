import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProcessingTray, type ProcessingTrayProps } from './processing-tray'

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
  describe('per-job controls', () => {
    const jobs = [
      { id: 'a', label: 'Ingesting a PDF', progress: 42 },
      { id: 'b', label: 'Transcribing a video', progress: 18, status: 'paused' as const },
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
          pauseLabel="Pause"
          resumeLabel="Resume"
          {...overrides}
        />,
      )
    }

    it('renders no controls when the host supplies no handlers', () => {
      renderTray()
      expect(screen.queryByTestId('processing-job-cancel-a')).not.toBeInTheDocument()
      expect(screen.queryByTestId('processing-job-pause-a')).not.toBeInTheDocument()
      expect(screen.queryByTestId('processing-job-resume-b')).not.toBeInTheDocument()
    })

    it('cancels the job the button belongs to', () => {
      const onCancelJob = vi.fn()
      renderTray({ onCancelJob })
      fireEvent.click(screen.getByTestId('processing-job-cancel-b'))
      expect(onCancelJob).toHaveBeenCalledExactlyOnceWith('b')
    })

    it('offers Pause for a running job and Resume for a paused one, never both', () => {
      const onPauseJob = vi.fn()
      const onResumeJob = vi.fn()
      renderTray({ onPauseJob, onResumeJob })

      expect(screen.getByTestId('processing-job-pause-a')).toBeInTheDocument()
      expect(screen.queryByTestId('processing-job-resume-a')).not.toBeInTheDocument()
      expect(screen.getByTestId('processing-job-resume-b')).toBeInTheDocument()
      expect(screen.queryByTestId('processing-job-pause-b')).not.toBeInTheDocument()

      fireEvent.click(screen.getByTestId('processing-job-pause-a'))
      expect(onPauseJob).toHaveBeenCalledExactlyOnceWith('a')
      fireEvent.click(screen.getByTestId('processing-job-resume-b'))
      expect(onResumeJob).toHaveBeenCalledExactlyOnceWith('b')
    })

    it('names the icon-only controls for assistive tech', () => {
      renderTray({ onCancelJob: vi.fn(), onPauseJob: vi.fn(), onResumeJob: vi.fn() })
      expect(screen.getByTestId('processing-job-cancel-a')).toHaveAccessibleName('Cancel')
      expect(screen.getByTestId('processing-job-pause-a')).toHaveAccessibleName('Pause')
      expect(screen.getByTestId('processing-job-resume-b')).toHaveAccessibleName('Resume')
    })
  })
})
