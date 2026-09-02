import type { Meta, StoryObj } from '@storybook/react-vite'
import { Stepper } from './stepper'

const steps = [
  { id: 'sources', label: 'Sources' },
  { id: 'diagnostic', label: 'Diagnostic' },
  { id: 'outline', label: 'Outline' },
  { id: 'expand', label: 'Expand' },
  { id: 'review', label: 'Review' },
]

const meta = {
  title: 'Components/Stepper',
  component: Stepper,
} satisfies Meta<typeof Stepper>

export default meta
type Story = StoryObj<typeof meta>

export const Start: Story = {
  args: { steps, currentIndex: 0 },
}

export const MidWizard: Story = {
  args: { steps, currentIndex: 2 },
}

export const LastStep: Story = {
  args: { steps, currentIndex: steps.length - 1 },
}
