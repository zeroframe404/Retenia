import type { DiagnosticModuleResultDto } from '@retenia/ipc-contract'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { DiagnosticModuleRow } from './diagnostic-module-row'

const meta: Meta<typeof DiagnosticModuleRow> = {
  title: 'Pathgen/DiagnosticModuleRow',
  component: DiagnosticModuleRow,
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof meta>

const known: DiagnosticModuleResultDto = {
  moduleId: '019213cd-0000-7000-8000-000000000101',
  specId: 'S01M1',
  title: 'Movimiento rectilíneo uniforme',
  sectionTitle: 'Cinemática',
  status: 'known',
  source: 'diagnostic',
  theta: 1.42,
  p: 0.805,
  answered: 2,
  inferred: 1,
  quickReview: false,
  lessonsCompleted: 3,
  seededCards: 14,
  pendingSeedLessons: 0,
  reverted: false,
  reopened: false,
  reopenReason: null,
}

export const Known: Story = {
  args: { module: known, advanced: false, onRevert: () => {} },
}

/** Lessons whose cards are still being written when the summary opens. */
export const KnownWaitingForCards: Story = {
  args: { module: { ...known, pendingSeedLessons: 2 }, advanced: false, onRevert: () => {} },
}

export const QuickReview: Story = {
  args: {
    module: {
      ...known,
      status: 'partial',
      quickReview: true,
      theta: 0.12,
      p: 0.53,
      lessonsCompleted: 0,
      seededCards: 0,
    },
    advanced: false,
    onRevert: () => {},
  },
}

export const ToStudy: Story = {
  args: {
    module: {
      ...known,
      status: 'unknown',
      source: 'never_seen',
      theta: -1.5,
      p: 0.18,
      answered: 0,
      inferred: 0,
      lessonsCompleted: 0,
      seededCards: 0,
    },
    advanced: false,
    onRevert: () => {},
  },
}

export const Reverted: Story = {
  args: { module: { ...known, reverted: true }, advanced: false, onRevert: () => {} },
}

export const ReopenedByLowRetention: Story = {
  args: {
    module: { ...known, reopened: true, reopenReason: 'low_retention' },
    advanced: false,
    onRevert: () => {},
  },
}

/** "Avanzado" on: θ, P and the evidence counts. */
export const Advanced: Story = {
  args: { module: known, advanced: true, onRevert: () => {} },
}
