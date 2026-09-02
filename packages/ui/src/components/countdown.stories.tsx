import type { Meta, StoryObj } from '@storybook/react-vite'
import { Countdown } from './countdown'

const meta = {
  title: 'Components/Countdown',
  component: Countdown,
} satisfies Meta<typeof Countdown>

export default meta
type Story = StoryObj<typeof meta>

export const InDays: Story = {
  args: { target: new Date(Date.now() + 6 * 86400_000 + 3 * 3600_000) },
}

export const InHours: Story = {
  args: { target: new Date(Date.now() + 3 * 3600_000 + 20 * 60_000) },
}

export const Due: Story = {
  args: { target: new Date(Date.now() - 1000) },
}
