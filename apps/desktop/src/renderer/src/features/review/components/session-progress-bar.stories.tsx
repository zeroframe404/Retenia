import type { Meta, StoryObj } from '@storybook/react-vite'
import { SessionProgressBar } from './session-progress-bar'

// An explicit annotation, not `satisfies Meta`: see `card-view.stories.tsx`'s comment.
const meta: Meta<typeof SessionProgressBar> = {
  title: 'Review/SessionProgressBar',
  component: SessionProgressBar,
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof meta>

const baseProgress = {
  sessionId: '019213cd-0000-7000-8000-000000000001',
  cursor: 0,
  total: 46,
  reviewed: 0,
  again: 0,
  hard: 0,
  skipped: 0,
  drillPending: 0,
  drillStarted: false,
  finished: false,
}

export const JustStarted: Story = {
  args: { progress: { ...baseProgress, remaining: 46 }, elapsedMs: 3_000 },
}

export const Halfway: Story = {
  args: {
    progress: { ...baseProgress, cursor: 23, remaining: 23 },
    elapsedMs: 6 * 60_000 + 12_000,
  },
}

export const AlmostDone: Story = {
  args: {
    progress: { ...baseProgress, cursor: 44, remaining: 2 },
    elapsedMs: 11 * 60_000 + 40_000,
  },
}
