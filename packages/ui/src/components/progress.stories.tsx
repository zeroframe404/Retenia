import type { Meta, StoryObj } from '@storybook/react-vite'
import { Progress, ProgressIndicator, ProgressRing, ProgressTrack } from './progress'

const meta = {
  title: 'Components/Progress',
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Linear: Story = {
  render: () => (
    <div className="w-64">
      <Progress value={65}>
        <ProgressTrack>
          <ProgressIndicator />
        </ProgressTrack>
      </Progress>
    </div>
  ),
}

export const Ring: Story = {
  render: () => (
    <div className="flex gap-6">
      <ProgressRing value={25} label="Daily goal" />
      <ProgressRing value={65} label="Daily goal" />
      <ProgressRing value={100} label="Daily goal" />
    </div>
  ),
}
