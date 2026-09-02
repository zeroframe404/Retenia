import type { Meta, StoryObj } from '@storybook/react-vite'
import { CostBadge } from './cost-badge'

const meta = {
  title: 'Components/CostBadge',
  component: CostBadge,
} satisfies Meta<typeof CostBadge>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { amountUsd: 0.12 },
}

export const WithBreakdown: Story = {
  args: {
    amountUsd: 0.47,
    breakdown: [
      { label: 'Extraction (Sonnet 5)', amountUsd: 0.21 },
      { label: 'Synthesis (Sonnet 5)', amountUsd: 0.18 },
      { label: 'Embeddings (local)', amountUsd: 0.0 },
      { label: 'QA judge (Gemini Flash)', amountUsd: 0.08 },
    ],
  },
}
