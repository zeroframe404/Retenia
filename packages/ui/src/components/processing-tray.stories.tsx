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

/**
 * A submitted AI batch alongside ordinary jobs (sub-phase 7.3).
 *
 * The row the sub-phase asks for — "Lote 12/40 lecciones · ~USD 1.10 · esperando" — with the
 * counting, the cost formatting and the state word all done by the caller, so this component
 * stays presentational and the strings stay translatable.
 */
export const WithBatches: Story = {
  args: {
    ...baseArgs,
    batchesLabel: 'Lotes de IA',
    jobs: [{ id: '1', label: 'Ingesting "Cálculo I.pdf"', progress: 42 }],
    batches: [
      { id: 'b1', label: 'Lote 12/40 lecciones', detail: '~USD 1.10 · esperando', progress: 30 },
      { id: 'b2', label: 'Lote 0/18 ítems', detail: '~USD 0.22 · enviando' },
    ],
    cancelLabel: 'Cancel',
    jobCountLabel: '3 jobs running',
  },
  render: (args) => {
    function Demo() {
      const [collapsed, setCollapsed] = useState(args.collapsed)
      const [batches, setBatches] = useState(args.batches ?? [])
      return (
        <ProcessingTray
          {...args}
          batches={batches}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((c) => !c)}
          onCancelBatch={(id) => setBatches((current) => current.filter((b) => b.id !== id))}
        />
      )
    }
    return <Demo />
  },
}

/** A batch that ended with failures among its requests: the error replaces the bar. */
export const WithFailedBatch: Story = {
  args: {
    ...baseArgs,
    batchesLabel: 'Lotes de IA',
    jobs: [],
    batches: [
      {
        id: 'b3',
        label: 'Lote 35/40 lecciones',
        detail: 'USD 1.04 · terminado',
        failed: true,
        error: '5 de 40 pedidos fallaron',
      },
    ],
    cancelLabel: 'Cancel',
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
