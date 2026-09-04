import type { Meta, StoryObj } from '@storybook/react-vite'
import { SessionSummary } from './session-summary'

// An explicit annotation, not `satisfies Meta`: see `components/card-view.stories.tsx`'s
// comment.
const meta: Meta<typeof SessionSummary> = {
  title: 'Review/SessionSummary',
  component: SessionSummary,
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

const overload = {
  plannedCards: 46,
  keptCards: 46,
  postponedCards: 0,
  completedShare: 1,
  byLevel: [],
  budgetMinutes: 20,
  estimatedMinutes: 12,
  overloaded: false,
  stillOverBudget: false,
}

const baseSummary = {
  sessionId: '019213cd-0000-7000-8000-000000000001',
  reviewed: 20,
  again: 2,
  hard: 3,
  skipped: 0,
  accuracy: 0.9,
  minutes: 11.4,
  xp: 0,
  postponed: 0,
  streak: {
    state: 'unknown' as const,
    current: 0,
    goalCards: 10,
    reviewedToday: 20,
    goalMet: false,
  },
  overload,
  finishedAt: '2026-09-04T00:12:00.000Z',
}

export const Loading: Story = {
  args: { summary: null, onBackHome: () => {}, onReviewMore: () => {} },
}

export const Typical: Story = {
  args: { summary: baseSummary, onBackHome: () => {}, onReviewMore: () => {} },
}

export const StreakGoalMet: Story = {
  args: {
    summary: {
      ...baseSummary,
      streak: { ...baseSummary.streak, state: 'extended', current: 8, goalMet: true },
    },
    onBackHome: () => {},
    onReviewMore: () => {},
  },
}

export const OverloadPostponed: Story = {
  name: 'Overload protection postponed maintenance cards',
  args: {
    summary: { ...baseSummary, postponed: 40 },
    onBackHome: () => {},
    onReviewMore: () => {},
  },
}

export const NothingWasDue: Story = {
  args: {
    summary: {
      ...baseSummary,
      reviewed: 0,
      again: 0,
      hard: 0,
      accuracy: null,
      minutes: 0,
    },
    onBackHome: () => {},
    onReviewMore: () => {},
  },
}
