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
 * Cancelling drops the job; pausing flips it to Resume and holds its progress. */
export const CancellableAndPausable: Story = {
  args: {
    ...baseArgs,
    jobs: [
      { id: '1', label: 'Ingesting "Cálculo I.pdf"', progress: 42 },
      { id: '2', label: 'Transcribing "Clase 03.mp4"', progress: 18, status: 'paused' },
      { id: '3', label: 'Generating embeddings' },
    ],
    jobCountLabel: '3 jobs running',
    cancelLabel: 'Cancel',
    pauseLabel: 'Pause',
    resumeLabel: 'Resume',
  },
  render: (args) => {
    function Demo() {
      const [collapsed, setCollapsed] = useState(args.collapsed)
      const [jobs, setJobs] = useState(args.jobs)
      const setStatus = (id: string, status: 'running' | 'paused') =>
        setJobs((current) => current.map((job) => (job.id === id ? { ...job, status } : job)))

      return (
        <ProcessingTray
          {...args}
          jobs={jobs}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((c) => !c)}
          onCancelJob={(id) => setJobs((current) => current.filter((job) => job.id !== id))}
          onPauseJob={(id) => setStatus(id, 'paused')}
          onResumeJob={(id) => setStatus(id, 'running')}
        />
      )
    }
    return <Demo />
  },
}
