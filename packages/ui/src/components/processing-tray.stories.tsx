import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { ProcessingTray } from './processing-tray'

const meta = {
  title: 'Components/ProcessingTray',
  component: ProcessingTray,
} satisfies Meta<typeof ProcessingTray>

export default meta
type Story = StoryObj<typeof meta>

const baseArgs = {
  collapsed: false,
  onToggleCollapsed: () => {},
  title: 'Processing',
  emptyState: 'No background jobs',
  collapseLabel: 'Collapse',
  expandLabel: 'Expand',
}

export const Empty: Story = {
  args: { ...baseArgs, jobs: [] },
  render: (args) => {
    function Demo() {
      const [collapsed, setCollapsed] = useState(args.collapsed)
      return (
        <ProcessingTray
          {...args}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((c) => !c)}
        />
      )
    }
    return <Demo />
  },
}

export const WithJobs: Story = {
  args: {
    ...baseArgs,
    jobs: [
      { id: '1', label: 'Ingesting "Cálculo I.pdf"', progress: 42 },
      { id: '2', label: 'Generating embeddings' },
    ],
    jobCountLabel: '2 jobs running',
  },
  render: (args) => {
    function Demo() {
      const [collapsed, setCollapsed] = useState(args.collapsed)
      return (
        <ProcessingTray
          {...args}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((c) => !c)}
        />
      )
    }
    return <Demo />
  },
}

/** docs/spec/08-ux.md §1.6: "long operations live in a progress panel with cancel/resume".
 * The queue has no `paused` status, so the controls are cancel and — for a failure — retry.
 * Cancelling drops the row; retrying puts the job back at the front of the queue. */
export const WithFailure: Story = {
  args: {
    ...baseArgs,
    jobs: [
      { id: '1', label: 'Ingesting "Cálculo I.pdf"', progress: 42 },
      {
        id: '2',
        label: 'Transcribing "Clase 03.mp4"',
        status: 'failed',
        error: 'ffmpeg exited with code 1: Invalid data found when processing input',
      },
      { id: '3', label: 'Generating embeddings', status: 'queued' },
    ],
    jobCountLabel: '3 jobs running',
    cancelLabel: 'Cancel',
    retryLabel: 'Retry',
    queuedLabel: 'Queued',
  },
  render: (args) => {
    function Demo() {
      const [collapsed, setCollapsed] = useState(args.collapsed)
      const [jobs, setJobs] = useState(args.jobs)

      return (
        <ProcessingTray
          {...args}
          jobs={jobs}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((c) => !c)}
          onCancelJob={(id) => setJobs((current) => current.filter((job) => job.id !== id))}
          onRetryJob={(id) =>
            setJobs((current) =>
              current.map((job) =>
                job.id === id ? { ...job, status: 'queued', error: undefined } : job,
              ),
            )
          }
        />
      )
    }
    return <Demo />
  },
}
