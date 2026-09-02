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
