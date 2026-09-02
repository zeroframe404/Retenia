import type { Meta, StoryObj } from '@storybook/react-vite'
import { HeartIcon } from 'lucide-react'
import { Button, IconButton } from './button'

const meta = {
  title: 'Components/Button',
  component: Button,
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'outline', 'ghost', 'destructive'],
    },
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
  },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { children: 'Continue lesson', variant: 'primary', size: 'md' },
}

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="destructive">Destructive</Button>
    </div>
  ),
}

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
    </div>
  ),
}

export const Disabled: Story = {
  args: { children: 'Not available yet', disabled: true },
}

export const IconButtons: Story = {
  render: () => (
    <div className="flex gap-3">
      <IconButton aria-label="Favorite" variant="primary">
        <HeartIcon />
      </IconButton>
      <IconButton aria-label="Favorite" variant="outline">
        <HeartIcon />
      </IconButton>
      <IconButton aria-label="Favorite" variant="ghost" size="sm">
        <HeartIcon />
      </IconButton>
    </div>
  ),
}
