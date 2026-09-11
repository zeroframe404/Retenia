import type { Meta, StoryObj } from '@storybook/react-vite'
import { DiagnosticProgressHeader } from './diagnostic-progress-header'

// An explicit annotation, not `satisfies Meta`: see `review/components/card-view.stories.tsx`.
const meta: Meta<typeof DiagnosticProgressHeader> = {
  title: 'Pathgen/DiagnosticProgressHeader',
  component: DiagnosticProgressHeader,
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

export const JustStarted: Story = {
  args: { asked: 0, remaining: 24, elapsedMs: 4_000 },
}

export const Halfway: Story = {
  args: { asked: 12, remaining: 11, elapsedMs: 6 * 60_000 + 30_000 },
}

/** The singular: "Queda ~1 pregunta". */
export const LastOne: Story = {
  args: { asked: 26, remaining: 1, elapsedMs: 13 * 60_000 + 5_000 },
}
