import type { Meta, StoryObj } from '@storybook/react-vite'
import { StrengthChip } from './strength-chip'

const meta = {
  title: 'Review/StrengthChip',
  component: StrengthChip,
} satisfies Meta<typeof StrengthChip>

export default meta
type Story = StoryObj<typeof meta>

const baseCard = {
  id: '019213cd-0000-7000-8000-000000000001',
  itemId: '019213cd-0000-7000-8000-000000000002',
  template: 'basic',
  payload: null,
  state: 2 as const,
  due: '2026-09-04T00:00:00.000Z',
  stability: 31,
  difficulty: 5.2,
  scheduledDays: 31,
  learningSteps: 0,
  reps: 6,
  lapses: 1,
  lastReview: '2026-08-04T00:00:00.000Z',
  leech: false,
}

export const Due: Story = {
  args: {
    entry: {
      kind: 'due',
      card: baseCard,
      level: 'normal',
      retrievability: 0.82,
      desiredRetention: 0.9,
      examId: null,
    },
  },
}

export const Critical: Story = {
  args: {
    entry: {
      kind: 'due',
      card: { ...baseCard, stability: 2, leech: true },
      level: 'urgent',
      retrievability: 0.22,
      desiredRetention: 0.97,
      examId: null,
    },
  },
}

export const New: Story = {
  args: {
    entry: {
      kind: 'new',
      card: { ...baseCard, stability: 0, reps: 0, lapses: 0, lastReview: null },
      level: 'normal',
      retrievability: 0,
      desiredRetention: 0.9,
      examId: null,
    },
  },
}

export const Relearning: Story = {
  args: {
    entry: {
      kind: 'relearning',
      card: baseCard,
      level: 'high',
      retrievability: 0.55,
      desiredRetention: 0.92,
      examId: null,
    },
  },
}

export const Exam: Story = {
  args: {
    entry: {
      kind: 'exam',
      card: baseCard,
      level: 'urgent',
      retrievability: 0.7,
      desiredRetention: 0.97,
      examId: '019213cd-0000-7000-8000-000000000009',
    },
  },
}
