import type { Meta, StoryObj } from '@storybook/react-vite'
import { Kbd } from './kbd'

const meta = {
  title: 'Components/Kbd',
  component: Kbd,
} satisfies Meta<typeof Kbd>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { children: 'Ctrl' },
}

export const Shortcut: Story = {
  render: () => (
    <div className="flex items-center gap-1 text-sm">
      <Kbd>Ctrl</Kbd>
      <span>+</span>
      <Kbd>K</Kbd>
    </div>
  ),
}
