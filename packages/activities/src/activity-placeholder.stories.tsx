import type { Meta, StoryObj } from '@storybook/react-vite'
import { ActivityHostPlaceholder } from './activity-placeholder'

const meta = {
  title: 'ActivityHostPlaceholder',
  component: ActivityHostPlaceholder,
} satisfies Meta<typeof ActivityHostPlaceholder>

export default meta
type Story = StoryObj<typeof meta>

export const Cloze: Story = {
  args: { family: 'cloze' },
}
