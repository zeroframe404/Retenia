import type { Meta, StoryObj } from '@storybook/react-vite'
import { GradeButtons } from './grade-buttons'

// An explicit annotation, not `satisfies Meta`: see `card-view.stories.tsx`'s comment.
const meta: Meta<typeof GradeButtons> = {
  title: 'Review/GradeButtons',
  component: GradeButtons,
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

const PREVIEW = [
  {
    grade: 1 as const,
    due: '2026-09-04T00:00:00.000Z',
    scheduledDays: 0,
    stability: 0.3,
    difficulty: 6.2,
  },
  {
    grade: 2 as const,
    due: '2026-09-05T00:00:00.000Z',
    scheduledDays: 5,
    stability: 1.1,
    difficulty: 6,
  },
  {
    grade: 3 as const,
    due: '2026-09-10T00:00:00.000Z',
    scheduledDays: 6,
    stability: 4.2,
    difficulty: 5.5,
  },
  {
    grade: 4 as const,
    due: '2026-09-12T00:00:00.000Z',
    scheduledDays: 8,
    stability: 9.8,
    difficulty: 5,
  },
]

export const FourButtons: Story = {
  args: { preview: PREVIEW, simple: false, onGrade: () => {} },
}

export const SimpleTwoButtons: Story = {
  args: { preview: PREVIEW, simple: true, onGrade: () => {} },
}

export const Disabled: Story = {
  args: { preview: PREVIEW, simple: false, disabled: true, onGrade: () => {} },
}

export const NoPreviewYet: Story = {
  name: 'No preview data (reinforcement/loading)',
  args: { preview: null, simple: false, onGrade: () => {} },
}
