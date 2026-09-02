import type { Meta, StoryObj } from '@storybook/react-vite'
import { AppShellPlaceholder } from './app-shell-placeholder'

const meta = {
  title: 'AppShellPlaceholder',
  component: AppShellPlaceholder,
} satisfies Meta<typeof AppShellPlaceholder>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { title: 'Retenia' },
}
