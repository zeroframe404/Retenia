import type { Meta, StoryObj } from '@storybook/react-vite'
import { LibraryIcon } from 'lucide-react'
import { Button } from './button'
import { EmptyState } from './empty-state'

const meta = {
  title: 'Components/EmptyState',
  component: EmptyState,
} satisfies Meta<typeof EmptyState>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { title: 'No sources yet' },
}

export const WithIconAndAction: Story = {
  args: {
    icon: <LibraryIcon />,
    title: 'No sources yet',
    description: 'Add a PDF, a video or a link and Retenia will turn it into a path.',
    action: <Button>Add source</Button>,
  },
}
