import type { Meta, StoryObj } from '@storybook/react-vite'
import { MemoryStrengthBar } from './memory-strength-bar'

const meta = {
  title: 'Components/MemoryStrengthBar',
  component: MemoryStrengthBar,
  argTypes: {
    retrievability: { control: { type: 'range', min: 0, max: 1, step: 0.01 } },
  },
} satisfies Meta<typeof MemoryStrengthBar>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { retrievability: 0.71 },
}

export const AllBands: Story = {
  args: { retrievability: 0.71 },
  render: () => (
    <div className="flex w-64 flex-col gap-3">
      <MemoryStrengthBar retrievability={0.12} />
      <MemoryStrengthBar retrievability={0.45} />
      <MemoryStrengthBar retrievability={0.71} />
      <MemoryStrengthBar retrievability={0.95} />
    </div>
  ),
}
