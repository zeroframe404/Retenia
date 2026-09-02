import type { Meta, StoryObj } from '@storybook/react-vite'
import { ErrorState } from './error-state'

const meta = {
  title: 'Components/ErrorState',
  component: ErrorState,
} satisfies Meta<typeof ErrorState>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { title: 'Could not load this path' },
}

export const WithRetry: Story = {
  args: {
    title: 'Could not load this path',
    description: 'Check your connection and try again.',
    retryLabel: 'Retry',
    onRetry: () => {},
  },
}
