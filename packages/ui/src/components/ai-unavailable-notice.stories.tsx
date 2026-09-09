import type { Meta, StoryObj } from '@storybook/react-vite'
import { AiUnavailableNotice } from './ai-unavailable-notice'

const meta = {
  title: 'Components/AiUnavailableNotice',
  component: AiUnavailableNotice,
} satisfies Meta<typeof AiUnavailableNotice>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { reason: 'No AI provider is configured yet — add a key in Settings.' },
}
