import type { Meta, StoryObj } from '@storybook/react-vite'
import { Badge } from './badge'

const meta = {
  title: 'Components/Badge',
  component: Badge,
  argTypes: {
    variant: {
      control: 'select',
      options: ['brand', 'neutral', 'correct', 'incorrect', 'xp', 'outline'],
    },
  },
} satisfies Meta<typeof Badge>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { children: 'New', variant: 'brand' },
}

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="brand">Brand</Badge>
      <Badge variant="neutral">Neutral</Badge>
      <Badge variant="correct">Correct</Badge>
      <Badge variant="incorrect">Incorrect</Badge>
      <Badge variant="xp">+15 XP</Badge>
      <Badge variant="outline">Outline</Badge>
    </div>
  ),
}
